use std::time::Duration;

use serde::{Deserialize, Serialize};
use url::Url;

use crate::{
    config::{validate_loopback_url, Config},
    error::ProxyError,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreparedRequest {
    pub account_key: String,
    pub messages: Vec<Message>,
    pub provider_url: String,
    #[serde(default)]
    pub api_key: String,
    pub model: String,
    pub model_label: String,
    #[serde(default)]
    pub allow_local_provider: bool,
    pub want_subject: bool,
    #[serde(default)]
    pub options: ProviderOptions,
    #[serde(default)]
    pub timeouts: TimeoutSettings,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderOptions {
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
}

impl Default for ProviderOptions {
    fn default() -> Self {
        Self {
            temperature: default_temperature(),
            max_tokens: default_max_tokens(),
            reasoning_effort: None,
        }
    }
}

const fn default_temperature() -> f64 {
    0.4
}

const fn default_max_tokens() -> u32 {
    1500
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct TimeoutSettings {
    pub connect_ms: Option<u64>,
    pub idle_ms: Option<u64>,
    pub total_ms: Option<u64>,
}

#[derive(Clone, Copy)]
pub struct EffectiveTimeouts {
    pub connect: Duration,
    pub idle: Duration,
    pub total: Duration,
}

#[derive(Serialize)]
pub struct ProviderPayload<'a> {
    pub model: &'a str,
    pub messages: &'a [Message],
    pub temperature: f64,
    pub stream: bool,
    pub max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<&'a str>,
}

impl PreparedRequest {
    pub fn validate(self, config: &Config) -> Result<(Self, EffectiveTimeouts), ProxyError> {
        if self.account_key.is_empty()
            || self.account_key.len() > 256
            || !self.account_key.bytes().all(|byte| byte.is_ascii_graphic())
        {
            return Err(ProxyError::invalid_prepare_response());
        }
        if self.messages.is_empty()
            || self.messages.len() > 32
            || self.messages.iter().any(|message| {
                !matches!(message.role.as_str(), "system" | "user" | "assistant")
                    || message.content.chars().count() > 100_000
            })
        {
            return Err(ProxyError::invalid_prepare_response());
        }
        if !valid_label(&self.model, 512)
            || !valid_label(&self.model_label, 512)
            || self.provider_url.len() > 4096
            || self.api_key.len() > 8192
            || !self.options.temperature.is_finite()
            || !(0.0..=2.0).contains(&self.options.temperature)
            || !(1..=100_000).contains(&self.options.max_tokens)
            || self
                .options
                .reasoning_effort
                .as_deref()
                .is_some_and(|value| value != "low")
        {
            return Err(ProxyError::invalid_prepare_response());
        }
        validate_provider_url(&self.provider_url, self.allow_local_provider)?;

        let maximum = config.max_provider_timeout;
        let timeout = |requested: Option<u64>, fallback: Duration| {
            requested
                .map(Duration::from_millis)
                .unwrap_or(fallback)
                .min(maximum)
        };
        let total = timeout(self.timeouts.total_ms, config.provider_total_timeout)
            .max(Duration::from_millis(1));
        let connect = timeout(self.timeouts.connect_ms, config.provider_connect_timeout)
            .max(Duration::from_millis(1))
            .min(total);
        let idle = timeout(self.timeouts.idle_ms, config.provider_idle_timeout)
            .max(Duration::from_millis(1))
            .min(total);
        Ok((
            self,
            EffectiveTimeouts {
                connect,
                idle,
                total,
            },
        ))
    }

    pub fn payload(&self) -> ProviderPayload<'_> {
        ProviderPayload {
            model: &self.model,
            messages: &self.messages,
            temperature: self.options.temperature,
            stream: true,
            max_tokens: self.options.max_tokens,
            reasoning_effort: self.options.reasoning_effort.as_deref(),
        }
    }
}

fn valid_label(value: &str, maximum: usize) -> bool {
    !value.is_empty() && value.chars().count() <= maximum && !value.chars().any(char::is_control)
}

pub fn validate_provider_url(value: &str, allow_local_provider: bool) -> Result<Url, ProxyError> {
    let url = Url::parse(value).map_err(|_| ProxyError::provider_not_configured())?;
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err(ProxyError::provider_not_configured());
    }
    match url.scheme() {
        "https" if url.host_str().is_some() => Ok(url),
        "http" if allow_local_provider => {
            validate_loopback_url(&url, false)
                .map_err(|_| ProxyError::provider_not_configured())?;
            Ok(url)
        }
        _ => Err(ProxyError::provider_not_configured()),
    }
}

#[derive(Deserialize)]
pub struct PrepareError {
    pub code: String,
}

#[cfg(test)]
mod tests {
    use super::{validate_provider_url, PreparedRequest};
    use crate::config::Config;

    #[test]
    fn http_is_only_an_explicit_loopback_exception() {
        assert!(validate_provider_url("http://127.0.0.1:11434/v1/chat/completions", true).is_ok());
        assert!(validate_provider_url("http://localhost:11434/v1/chat/completions", true).is_ok());
        assert!(
            validate_provider_url("http://127.0.0.1:11434/v1/chat/completions", false).is_err()
        );
        assert!(validate_provider_url("http://example.com/v1/chat/completions", true).is_err());
        assert!(
            validate_provider_url("https://api.example.com/v1/chat/completions", false).is_ok()
        );
        assert!(validate_provider_url("https://user:pass@example.com/v1", false).is_err());
    }

    #[test]
    fn prepare_schema_is_strict_and_timeouts_are_clamped() {
        let config = Config::from_lookup(|name| {
            (name == "SNAPPY_AI_PROXY_SERVICE_CREDENTIAL")
                .then(|| "test-credential-1234567890".to_owned())
        })
        .unwrap();
        let mut value = serde_json::json!({
            "account_key": "account-hash",
            "messages": [{"role":"user","content":"prompt"}],
            "provider_url": "https://api.example.com/v1/chat/completions",
            "api_key": "secret",
            "model": "model",
            "model_label": "Mock · model",
            "allow_local_provider": false,
            "want_subject": true
        });
        value["timeouts"] =
            serde_json::json!({"connect_ms": 0, "idle_ms": 999999999, "total_ms": 1000});
        let prepared: PreparedRequest = serde_json::from_value(value).unwrap();
        let (_, timeouts) = prepared.validate(&config).unwrap();
        assert_eq!(1000, timeouts.total.as_millis());
        assert_eq!(1, timeouts.connect.as_millis());
        assert_eq!(1000, timeouts.idle.as_millis());
    }

    #[test]
    fn reasoning_effort_is_optional_and_strictly_low() {
        let config = Config::from_lookup(|name| {
            (name == "SNAPPY_AI_PROXY_SERVICE_CREDENTIAL")
                .then(|| "test-credential-1234567890".to_owned())
        })
        .unwrap();
        let base = serde_json::json!({
            "account_key": "account-hash",
            "messages": [{"role":"user","content":"prompt"}],
            "provider_url": "https://api.example.com/v1/chat/completions",
            "model": "zai-test",
            "model_label": "Mock · zai-test",
            "want_subject": false
        });

        let prepared: PreparedRequest = serde_json::from_value(base.clone()).unwrap();
        let (prepared, _) = prepared.validate(&config).unwrap();
        let payload = serde_json::to_value(prepared.payload()).unwrap();
        assert!(payload.get("reasoning_effort").is_none());

        let mut with_reasoning = base.clone();
        with_reasoning["options"] = serde_json::json!({"reasoning_effort": "low"});
        let prepared: PreparedRequest = serde_json::from_value(with_reasoning).unwrap();
        let (prepared, _) = prepared.validate(&config).unwrap();
        let payload = serde_json::to_value(prepared.payload()).unwrap();
        assert_eq!("low", payload["reasoning_effort"]);

        let mut invalid = base;
        invalid["options"] = serde_json::json!({"reasoning_effort": "high"});
        let prepared: PreparedRequest = serde_json::from_value(invalid).unwrap();
        assert!(prepared.validate(&config).is_err());
    }
}
