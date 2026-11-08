use bytes::BytesMut;
use serde::Serialize;
use serde_json::Value;

use crate::{error::ProxyError, subject::trim_php_bytes};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Usage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<u64>,
}

impl Usage {
    fn from_value(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        let usage = Self {
            prompt_tokens: object.get("prompt_tokens").and_then(Value::as_u64),
            completion_tokens: object.get("completion_tokens").and_then(Value::as_u64),
            total_tokens: object.get("total_tokens").and_then(Value::as_u64),
        };
        (usage.prompt_tokens.is_some()
            || usage.completion_tokens.is_some()
            || usage.total_tokens.is_some())
        .then_some(usage)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParserOutput {
    pub text: Option<String>,
    pub usage: Option<Usage>,
}

pub struct Finish {
    pub output: Option<ParserOutput>,
    pub completed: bool,
}

/// Bounded incremental parser for OpenAI-compatible upstream SSE.
pub struct SseParser {
    input: BytesMut,
    line: Vec<u8>,
    data_lines: Vec<Vec<u8>>,
    data_bytes: usize,
    completed: bool,
    max_line_bytes: usize,
    max_event_bytes: usize,
}

impl SseParser {
    pub fn new(max_line_bytes: usize, max_event_bytes: usize) -> Self {
        Self {
            input: BytesMut::new(),
            line: Vec::new(),
            data_lines: Vec::new(),
            data_bytes: 0,
            completed: false,
            max_line_bytes,
            max_event_bytes,
        }
    }

    pub fn push(&mut self, chunk: &[u8]) {
        if !self.completed {
            self.input.extend_from_slice(chunk);
        }
    }

    pub fn completed(&self) -> bool {
        self.completed
    }

    /// Consumes buffered input until at most one complete upstream event is available.
    pub fn next_output(&mut self) -> Result<Option<ParserOutput>, ProxyError> {
        while !self.completed {
            let Some(newline) = self.input.iter().position(|byte| *byte == b'\n') else {
                if !self.input.is_empty() {
                    let remaining = self.input.split();
                    self.append(&remaining)?;
                }
                return Ok(None);
            };
            let mut line = self.input.split_to(newline + 1);
            line.truncate(newline);
            self.append(&line)?;
            let consumed = std::mem::take(&mut self.line);
            if let Some(output) = self.consume_line(consumed)? {
                return Ok(Some(output));
            }
        }
        Ok(None)
    }

    pub fn finish(&mut self) -> Result<Finish, ProxyError> {
        if self.completed {
            return Ok(Finish {
                output: None,
                completed: true,
            });
        }
        if !self.input.is_empty() {
            let remaining = self.input.split();
            self.append(&remaining)?;
        }
        let mut output = None;
        if !self.line.is_empty() {
            let line = std::mem::take(&mut self.line);
            output = self.consume_line(line)?;
        }
        if !self.completed && !self.data_lines.is_empty() {
            output = self.dispatch()?;
        }
        Ok(Finish {
            output,
            completed: self.completed,
        })
    }

    fn append(&mut self, part: &[u8]) -> Result<(), ProxyError> {
        if self.line.len() + part.len() > self.max_line_bytes {
            return Err(ProxyError::upstream_too_large());
        }
        self.line.extend_from_slice(part);
        Ok(())
    }

    fn consume_line(&mut self, mut line: Vec<u8>) -> Result<Option<ParserOutput>, ProxyError> {
        while line.last() == Some(&b'\r') {
            line.pop();
        }
        if line.is_empty() {
            return self.dispatch();
        }
        if line[0] == b':' {
            return Ok(None);
        }
        let data = if line == b"data" {
            Some(&line[..])
        } else if line.starts_with(b"data:") {
            Some(&line[5..])
        } else {
            None
        };
        if let Some(mut data) = data {
            if data.first() == Some(&b' ') {
                data = &data[1..];
            }
            let bytes = data.len() + usize::from(!self.data_lines.is_empty());
            if self.data_bytes + bytes > self.max_event_bytes {
                return Err(ProxyError::upstream_too_large());
            }
            self.data_lines.push(data.to_vec());
            self.data_bytes += bytes;
        }
        Ok(None)
    }

    fn dispatch(&mut self) -> Result<Option<ParserOutput>, ProxyError> {
        if self.data_lines.is_empty() {
            return Ok(None);
        }
        let data = self
            .data_lines
            .iter()
            .map(Vec::as_slice)
            .collect::<Vec<_>>()
            .join(b"\n".as_slice());
        self.data_lines.clear();
        self.data_bytes = 0;
        let trimmed = trim_php_bytes(&data);
        if trimmed.is_empty() {
            return Ok(None);
        }
        if trimmed == b"[DONE]" {
            self.completed = true;
            return Ok(None);
        }

        let value: Value =
            serde_json::from_slice(trimmed).map_err(|_| ProxyError::upstream_malformed_json())?;
        let object = value
            .as_object()
            .ok_or_else(ProxyError::upstream_malformed_json)?;
        if object.contains_key("error") {
            return Err(ProxyError::upstream_error());
        }
        let usage = object.get("usage").and_then(Usage::from_value);
        let completed = matches!(object.get("type"), Some(Value::String(kind)) if kind == "completed" || kind == "response.completed")
            || matches!(object.get("status"), Some(Value::String(status)) if status == "completed")
            || object.get("done") == Some(&Value::Bool(true));
        if completed {
            self.completed = true;
            return Ok(usage.map(|usage| ParserOutput {
                text: None,
                usage: Some(usage),
            }));
        }

        let Some(choices) = object.get("choices") else {
            return Ok(with_usage(None, usage));
        };
        let choices = choices
            .as_array()
            .ok_or_else(ProxyError::upstream_malformed_json)?;
        let Some(choice) = choices.first() else {
            return Ok(with_usage(None, usage));
        };
        let choice = choice
            .as_object()
            .ok_or_else(ProxyError::upstream_malformed_json)?;
        let delta = choice.get("delta").filter(|value| !value.is_null());
        if delta.is_some_and(|value| !value.is_object()) {
            return Err(ProxyError::upstream_malformed_json());
        }
        let content = delta
            .and_then(|delta| delta.get("content"))
            .filter(|value| !value.is_null());
        let Some(content) = content else {
            return Ok(with_usage(None, usage));
        };
        let text = match content {
            Value::String(text) if text.is_empty() => None,
            Value::String(text) => Some(text.clone()),
            Value::Array(parts) => {
                let mut text = String::new();
                for part in parts {
                    let Some(part) = part.as_object() else {
                        continue;
                    };
                    if part.get("type") != Some(&Value::String("text".to_owned())) {
                        continue;
                    }
                    if let Some(value) = part.get("text") {
                        let value = value
                            .as_str()
                            .ok_or_else(ProxyError::upstream_malformed_json)?;
                        text.push_str(value);
                    }
                }
                (!text.is_empty()).then_some(text)
            }
            _ => return Err(ProxyError::upstream_malformed_json()),
        };
        Ok(with_usage(text, usage))
    }
}

fn with_usage(text: Option<String>, usage: Option<Usage>) -> Option<ParserOutput> {
    if text.is_none() && usage.is_none() {
        None
    } else {
        Some(ParserOutput { text, usage })
    }
}

#[cfg(test)]
mod tests {
    use super::{ParserOutput, SseParser, Usage};

    fn parse(chunks: &[&[u8]]) -> Result<(String, Option<Usage>), &'static str> {
        let mut parser = SseParser::new(65_536, 262_144);
        let mut text = String::new();
        let mut usage = None;
        for chunk in chunks {
            parser.push(chunk);
            while let Some(output) = parser.next_output().map_err(|error| error.code)? {
                if let Some(delta) = output.text {
                    text.push_str(&delta);
                }
                if let Some(value) = output.usage {
                    usage = Some(value);
                }
            }
        }
        let finish = parser.finish().map_err(|error| error.code)?;
        if let Some(output) = finish.output {
            if let Some(delta) = output.text {
                text.push_str(&delta);
            }
            if let Some(value) = output.usage {
                usage = Some(value);
            }
        }
        if !finish.completed {
            return Err("upstream_incomplete");
        }
        Ok((text, usage))
    }

    #[test]
    fn handles_crlf_arrays_multiline_json_and_done() {
        let chunks: &[&[u8]] = &[
            b": keepalive\r\n\r\n",
            b"data: {\"choices\":[{\"delta\":{\"content\":\"Hallo\"}}]}\r\n\r\n",
            b"data: {\"choices\":[{\"delta\":{\"content\":[{\"type\":\"thinking\",\"thinking\":\"secret\"},{\"type\":\"text\",\"text\":\",\"},{\"type\":\"text\",\"text\":\" Gr\xc3\xbc\xc3\x9fe \xe2\x9c\x93\"}]}}]}\n\n",
            b"data: {\"choices\":[\n",
            b"data: {\"delta\":{\"content\":\"!\"}}]}\n\n",
            b"data: [DONE]",
        ];
        assert_eq!("Hallo, Grüße ✓!", parse(chunks).unwrap().0);
    }

    #[test]
    fn every_byte_split_preserves_unicode() {
        let stream =
            "data: {\"choices\":[{\"delta\":{\"content\":\"Grüße ✓\"}}]}\r\n\r\ndata: [DONE]\n\n";
        for split in 0..=stream.len() {
            let result = parse(&[&stream.as_bytes()[..split], &stream.as_bytes()[split..]]);
            assert_eq!("Grüße ✓", result.unwrap().0, "split {split}");
        }
        let bytes = stream.as_bytes().chunks(1).collect::<Vec<_>>();
        assert_eq!("Grüße ✓", parse(&bytes).unwrap().0);
    }

    #[test]
    fn controlled_errors_cover_malformed_and_incomplete_eof() {
        assert_eq!(
            "upstream_malformed_json",
            parse(&[b"data: {not-json}\n\n"]).unwrap_err()
        );
        assert_eq!(
            "upstream_malformed_json",
            parse(&[b"data: {\"choices\": ["]).unwrap_err()
        );
        assert_eq!(
            "upstream_incomplete",
            parse(&[b"data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n"])
                .unwrap_err()
        );
        assert_eq!(
            "upstream_error",
            parse(&[b"data: {\"error\":{\"message\":\"private\"}}\n\n"]).unwrap_err()
        );
    }

    #[test]
    fn completion_variants_and_usage_are_supported() {
        let (text, usage) = parse(&[
            b"data: {\"choices\":[{\"delta\":{\"content\":\"Fertig\"}}]}\n\n",
            b"data: {\"type\":\"response.completed\",\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"total_tokens\":5}}\n\n",
        ])
        .unwrap();
        assert_eq!("Fertig", text);
        assert_eq!(Some(5), usage.unwrap().total_tokens);
        assert_eq!("", parse(&[b"data: [DONE]\n\n"]).unwrap().0);
    }

    #[test]
    fn parser_bounds_lines_and_events() {
        let mut parser = SseParser::new(8, 16);
        parser.push(b"data: 123456789");
        assert_eq!("upstream_too_large", parser.next_output().unwrap_err().code);
        let mut parser = SseParser::new(64, 4);
        parser.push(b"data: 12345\n\n");
        assert_eq!("upstream_too_large", parser.next_output().unwrap_err().code);
    }

    #[test]
    fn malformed_shapes_do_not_panic() {
        for stream in [
            "data: {\"choices\":{}}\n\n",
            "data: {\"choices\":[null]}\n\n",
            "data: {\"choices\":[{\"delta\":3}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":3}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":[{\"type\":\"text\",\"text\":3}]}}]}\n\n",
        ] {
            assert_eq!(
                "upstream_malformed_json",
                parse(&[stream.as_bytes()]).unwrap_err()
            );
        }
        let empty = ParserOutput::default();
        assert!(empty.text.is_none());
    }
}
