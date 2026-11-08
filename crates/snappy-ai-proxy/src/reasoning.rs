/// Incrementally removes `<think>` blocks without leaking split opening tags.
#[derive(Default)]
pub struct ReasoningFilter {
    in_think: bool,
    pending: String,
}

impl ReasoningFilter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, text: &str) -> String {
        let mut remaining = std::mem::take(&mut self.pending) + text;
        let mut output = String::new();
        while !remaining.is_empty() {
            let tag = if self.in_think { "</think>" } else { "<think>" };
            if let Some(position) = remaining.find(tag) {
                if !self.in_think && position > 0 {
                    output.push_str(&remaining[..position]);
                }
                remaining.drain(..position + tag.len());
                self.in_think = !self.in_think;
                continue;
            }

            let keep = partial_tag_suffix(&remaining, tag);
            let safe = remaining.len() - keep;
            if !self.in_think && safe > 0 {
                output.push_str(&remaining[..safe]);
            }
            self.pending = remaining[safe..].to_owned();
            break;
        }
        output
    }

    pub fn finish(&mut self) -> String {
        if self.in_think {
            self.pending.clear();
            String::new()
        } else {
            std::mem::take(&mut self.pending)
        }
    }
}

fn partial_tag_suffix(text: &str, tag: &str) -> usize {
    let maximum = text.len().min(tag.len() - 1);
    (1..=maximum)
        .rev()
        .find(|length| text.ends_with(&tag[..*length]))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::ReasoningFilter;

    fn filter(chunks: &[&str]) -> String {
        let mut filter = ReasoningFilter::new();
        let mut output = chunks
            .iter()
            .map(|chunk| filter.push(chunk))
            .collect::<String>();
        output.push_str(&filter.finish());
        output
    }

    #[test]
    fn removes_split_reasoning_without_leaking_tags() {
        assert_eq!(
            "  Hallo Welt",
            filter(&["  <thi", "nk>verborgen</think>Hallo", " Welt"])
        );
        assert_eq!("Vor ", filter(&["Vor <think>secret"]));
        assert_eq!("Literal <thi", filter(&["Literal <thi"]));
        assert_eq!("ABC", filter(&["A<think>x</think>B<think>y</think>C"]));
    }

    #[test]
    fn every_boundary_preserves_literal_unicode_text() {
        let chunks = ["Ä<think>秘密</think>Grüße ✓"];
        for split in 0..chunks[0].len() {
            if !chunks[0].is_char_boundary(split) {
                continue;
            }
            assert_eq!(
                "ÄGrüße ✓",
                filter(&[&chunks[0][..split], &chunks[0][split..]])
            );
        }
    }
}
