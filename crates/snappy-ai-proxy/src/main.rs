use snappy_ai_proxy::{router, Config, ProxyService};

#[tokio::main]
async fn main() {
    if let Err(()) = run().await {
        std::process::exit(1);
    }
}

async fn run() -> Result<(), ()> {
    let config = match Config::from_env() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("snappy-ai-proxy configuration error: {error}");
            return Err(());
        }
    };
    let listen_addr = config.listen_addr;
    let service = match ProxyService::new(config) {
        Ok(service) => service,
        Err(_) => {
            eprintln!("snappy-ai-proxy could not initialize its HTTP client");
            return Err(());
        }
    };
    let listener = match tokio::net::TcpListener::bind(listen_addr).await {
        Ok(listener) => listener,
        Err(_) => {
            eprintln!("snappy-ai-proxy could not bind its loopback listener");
            return Err(());
        }
    };
    eprintln!("snappy-ai-proxy listening on {listen_addr}");
    axum::serve(listener, router(service))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .map_err(|_| {
            eprintln!("snappy-ai-proxy HTTP server failed");
        })
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        if let Ok(mut terminate) = signal(SignalKind::terminate()) {
            tokio::select! {
                result = tokio::signal::ctrl_c() => {
                    let _ = result;
                }
                _ = terminate.recv() => {}
            }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}
