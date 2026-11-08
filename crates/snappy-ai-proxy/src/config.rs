use std::{env, fmt, net::SocketAddr, time::Duration};

use axum::http::HeaderValue;
use url::Url;

use crate::draft::MAX_BROWSER_BODY_BYTES;

pub const DEFAULT_LISTEN: &str = "127.0.0.1:3001";
pub const DEFAULT_PREPARE_URL: &str = "http://127.0.0.1:8081/internal/ai/prepare";

#[derive(Clone)]
pub struct Config {
    pub listen_addr: SocketAddr,
    pub prepare_url: Url,
    service_credential: HeaderValue,
    pub max_browser_body_bytes: usize,
    pub max_prepare_body_bytes: usize,
    pub max_upstream_bytes: usize,
    pub max_text_bytes: usize,
    pub max_sse_line_bytes: usize,
    pub max_sse_event_bytes: usize,
    pub max_forwarded_header_bytes: usize,
    pub channel_capacity: usize,
    pub prepare_permits: usize,
    pub upstream_permits: usize,
    pub per_account_permits: usize,
    pub prepare_connect_timeout: Duration,
    pub prepare_timeout: Duration,
    pub provider_connect_timeout: Duration,
    pub provider_idle_timeout: Duration,
    pub provider_total_timeout: Duration,
    pub max_provider_timeout: Duration,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|name| env::var(name).ok())
    }

    pub fn from_lookup(
        mut lookup: impl FnMut(&str) -> Option<String>,
    ) -> Result<Self, ConfigError> {
        let credential = lookup("SNAPPY_AI_PROXY_SERVICE_CREDENTIAL")
            .ok_or_else(|| ConfigError::missing("SNAPPY_AI_PROXY_SERVICE_CREDENTIAL"))?;
        if !(16..=4096).contains(&credential.len()) {
            return Err(ConfigError::invalid(
                "SNAPPY_AI_PROXY_SERVICE_CREDENTIAL must contain 16 to 4096 bytes",
            ));
        }
        let mut service_credential = HeaderValue::from_str(&credential).map_err(|_| {
            ConfigError::invalid("SNAPPY_AI_PROXY_SERVICE_CREDENTIAL is not a valid header value")
        })?;
        service_credential.set_sensitive(true);

        let listen_text =
            lookup("SNAPPY_AI_PROXY_LISTEN_ADDR").unwrap_or_else(|| DEFAULT_LISTEN.to_owned());
        let listen_addr = listen_text
            .parse::<SocketAddr>()
            .map_err(|_| ConfigError::invalid("SNAPPY_AI_PROXY_LISTEN_ADDR"))?;
        if !listen_addr.ip().is_loopback() {
            return Err(ConfigError::invalid(
                "SNAPPY_AI_PROXY_LISTEN_ADDR must be loopback-only",
            ));
        }

        let prepare_text =
            lookup("SNAPPY_AI_PROXY_PREPARE_URL").unwrap_or_else(|| DEFAULT_PREPARE_URL.to_owned());
        let prepare_url = Url::parse(&prepare_text)
            .map_err(|_| ConfigError::invalid("SNAPPY_AI_PROXY_PREPARE_URL"))?;
        validate_loopback_url(&prepare_url, true).map_err(|_| {
            ConfigError::invalid("SNAPPY_AI_PROXY_PREPARE_URL must use loopback HTTP(S)")
        })?;

        let max_provider_timeout = Duration::from_millis(parse_u64(
            lookup("SNAPPY_AI_PROXY_MAX_PROVIDER_TIMEOUT_MS"),
            300_000,
            1,
            3_600_000,
            "SNAPPY_AI_PROXY_MAX_PROVIDER_TIMEOUT_MS",
        )?);
        let provider_connect_timeout = Duration::from_millis(
            parse_u64(
                lookup("SNAPPY_AI_PROXY_PROVIDER_CONNECT_TIMEOUT_MS"),
                10_000,
                1,
                3_600_000,
                "SNAPPY_AI_PROXY_PROVIDER_CONNECT_TIMEOUT_MS",
            )?
            .min(duration_millis(max_provider_timeout)),
        );
        let provider_idle_timeout = Duration::from_millis(
            parse_u64(
                lookup("SNAPPY_AI_PROXY_PROVIDER_IDLE_TIMEOUT_MS"),
                30_000,
                1,
                3_600_000,
                "SNAPPY_AI_PROXY_PROVIDER_IDLE_TIMEOUT_MS",
            )?
            .min(duration_millis(max_provider_timeout)),
        );
        let provider_total_timeout = Duration::from_millis(
            parse_u64(
                lookup("SNAPPY_AI_PROXY_PROVIDER_TOTAL_TIMEOUT_MS"),
                90_000,
                1,
                3_600_000,
                "SNAPPY_AI_PROXY_PROVIDER_TOTAL_TIMEOUT_MS",
            )?
            .min(duration_millis(max_provider_timeout)),
        );

        Ok(Self {
            listen_addr,
            prepare_url,
            service_credential,
            max_browser_body_bytes: parse_usize(
                lookup("SNAPPY_AI_PROXY_MAX_BROWSER_BODY_BYTES"),
                MAX_BROWSER_BODY_BYTES,
                1,
                MAX_BROWSER_BODY_BYTES,
                "SNAPPY_AI_PROXY_MAX_BROWSER_BODY_BYTES",
            )?,
            max_prepare_body_bytes: parse_usize(
                lookup("SNAPPY_AI_PROXY_MAX_PREPARE_BODY_BYTES"),
                1_048_576,
                1,
                8_388_608,
                "SNAPPY_AI_PROXY_MAX_PREPARE_BODY_BYTES",
            )?,
            max_upstream_bytes: parse_usize(
                lookup("SNAPPY_AI_PROXY_MAX_UPSTREAM_BYTES"),
                4_194_304,
                1,
                67_108_864,
                "SNAPPY_AI_PROXY_MAX_UPSTREAM_BYTES",
            )?,
            max_text_bytes: parse_usize(
                lookup("SNAPPY_AI_PROXY_MAX_TEXT_BYTES"),
                1_048_576,
                1,
                16_777_216,
                "SNAPPY_AI_PROXY_MAX_TEXT_BYTES",
            )?,
            max_sse_line_bytes: parse_usize(
                lookup("SNAPPY_AI_PROXY_MAX_SSE_LINE_BYTES"),
                65_536,
                1,
                1_048_576,
                "SNAPPY_AI_PROXY_MAX_SSE_LINE_BYTES",
            )?,
            max_sse_event_bytes: parse_usize(
                lookup("SNAPPY_AI_PROXY_MAX_SSE_EVENT_BYTES"),
                262_144,
                1,
                4_194_304,
                "SNAPPY_AI_PROXY_MAX_SSE_EVENT_BYTES",
            )?,
            max_forwarded_header_bytes: parse_usize(
                lookup("SNAPPY_AI_PROXY_MAX_FORWARDED_HEADER_BYTES"),
                32_768,
                1,
                65_536,
                "SNAPPY_AI_PROXY_MAX_FORWARDED_HEADER_BYTES",
            )?,
            channel_capacity: parse_usize(
                lookup("SNAPPY_AI_PROXY_CHANNEL_CAPACITY"),
                16,
                1,
                1024,
                "SNAPPY_AI_PROXY_CHANNEL_CAPACITY",
            )?,
            prepare_permits: parse_usize(
                lookup("SNAPPY_AI_PROXY_PREPARE_PERMITS"),
                16,
                1,
                4096,
                "SNAPPY_AI_PROXY_PREPARE_PERMITS",
            )?,
            upstream_permits: parse_usize(
                lookup("SNAPPY_AI_PROXY_UPSTREAM_PERMITS"),
                8,
                1,
                4096,
                "SNAPPY_AI_PROXY_UPSTREAM_PERMITS",
            )?,
            per_account_permits: parse_usize(
                lookup("SNAPPY_AI_PROXY_PER_ACCOUNT_PERMITS"),
                2,
                1,
                4096,
                "SNAPPY_AI_PROXY_PER_ACCOUNT_PERMITS",
            )?,
            prepare_connect_timeout: Duration::from_millis(parse_u64(
                lookup("SNAPPY_AI_PROXY_PREPARE_CONNECT_TIMEOUT_MS"),
                5_000,
                1,
                300_000,
                "SNAPPY_AI_PROXY_PREPARE_CONNECT_TIMEOUT_MS",
            )?),
            prepare_timeout: Duration::from_millis(parse_u64(
                lookup("SNAPPY_AI_PROXY_PREPARE_TIMEOUT_MS"),
                30_000,
                1,
                300_000,
                "SNAPPY_AI_PROXY_PREPARE_TIMEOUT_MS",
            )?),
            provider_connect_timeout,
            provider_idle_timeout,
            provider_total_timeout,
            max_provider_timeout,
        })
    }

    pub fn service_credential(&self) -> HeaderValue {
        self.service_credential.clone()
    }
}

pub struct UrlPolicyError;

pub fn validate_loopback_url(url: &Url, allow_https: bool) -> Result<(), UrlPolicyError> {
    let scheme_ok = url.scheme() == "http" || (allow_https && url.scheme() == "https");
    if !scheme_ok
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(UrlPolicyError);
    }
    match url.host() {
        Some(url::Host::Domain(host)) if host.eq_ignore_ascii_case("localhost") => Ok(()),
        Some(url::Host::Ipv4(address)) if address.is_loopback() => Ok(()),
        Some(url::Host::Ipv6(address)) if address.is_loopback() => Ok(()),
        _ => Err(UrlPolicyError),
    }
}

fn parse_usize(
    value: Option<String>,
    default: usize,
    minimum: usize,
    maximum: usize,
    name: &'static str,
) -> Result<usize, ConfigError> {
    let parsed = match value {
        Some(value) => value
            .parse::<usize>()
            .map_err(|_| ConfigError::invalid(name))?,
        None => default,
    };
    if !(minimum..=maximum).contains(&parsed) {
        return Err(ConfigError::invalid(name));
    }
    Ok(parsed)
}

fn parse_u64(
    value: Option<String>,
    default: u64,
    minimum: u64,
    maximum: u64,
    name: &'static str,
) -> Result<u64, ConfigError> {
    let parsed = match value {
        Some(value) => value
            .parse::<u64>()
            .map_err(|_| ConfigError::invalid(name))?,
        None => default,
    };
    if !(minimum..=maximum).contains(&parsed) {
        return Err(ConfigError::invalid(name));
    }
    Ok(parsed)
}

fn duration_millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

pub struct ConfigError {
    message: String,
}

impl ConfigError {
    fn missing(name: &'static str) -> Self {
        Self {
            message: format!("required environment variable {name} is missing"),
        }
    }

    fn invalid(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl fmt::Debug for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ConfigError {}

#[cfg(test)]
mod tests {
    use super::{validate_loopback_url, Config};
    use url::Url;

    fn credential(name: &str) -> Option<String> {
        (name == "SNAPPY_AI_PROXY_SERVICE_CREDENTIAL")
            .then(|| "test-credential-1234567890".to_owned())
    }

    #[test]
    fn requires_a_credential_and_loopback_listen_address() {
        assert!(Config::from_lookup(|_| None).is_err());
        let error = Config::from_lookup(|name| {
            if name == "SNAPPY_AI_PROXY_SERVICE_CREDENTIAL" {
                credential(name)
            } else if name == "SNAPPY_AI_PROXY_LISTEN_ADDR" {
                Some("0.0.0.0:3001".to_owned())
            } else {
                None
            }
        });
        assert!(error.is_err());
    }

    #[test]
    fn defaults_are_bounded_and_loopback_only() {
        let config = Config::from_lookup(credential).expect("default config");
        assert_eq!("127.0.0.1:3001", config.listen_addr.to_string());
        assert_eq!(65_536, config.max_browser_body_bytes);
        assert_eq!(16, config.channel_capacity);
    }

    #[test]
    fn local_url_policy_rejects_remote_or_userinfo() {
        assert!(
            validate_loopback_url(&Url::parse("http://127.0.0.1:8081/x").unwrap(), true).is_ok()
        );
        assert!(validate_loopback_url(&Url::parse("http://[::1]:8081/x").unwrap(), true).is_ok());
        assert!(validate_loopback_url(&Url::parse("http://example.com/x").unwrap(), true).is_err());
        assert!(validate_loopback_url(&Url::parse("https://127.0.0.1/x").unwrap(), false).is_err());
        assert!(
            validate_loopback_url(&Url::parse("http://user@127.0.0.1/x").unwrap(), true).is_err()
        );
    }
}
