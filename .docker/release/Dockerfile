# syntax=docker/dockerfile:1

ARG TARGETARCH=amd64

FROM alpine:3.24.3@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a AS builder
RUN apk add --no-cache php85 php85-json php-phar php-zip
WORKDIR /source
COPY . .
# Patch release.php with hotfix from: https://github.com/xgbstar1/snappymail-docker/blob/main/Dockerfile, so that release.php doesn't fail with error
# Fail if upstream changes the expected line; sed otherwise succeeds even when it patches nothing.
RUN set -eux; \
    expected="if (!rename('snappymail/v/0.0.0', \"snappymail/v/{\$package->version}\")) {"; \
    replacement='if (!!system("mv snappymail/v/0.0.0 snappymail/v/{$package->version}")) {'; \
    tr -d '\r' < cli/release.php > /tmp/release.php; \
    test "$(grep -Fxc "$expected" /tmp/release.php)" = 1; \
    sed -i 's_^if.*rename.*snappymail.v.0.0.0.*$_if (!!system("mv snappymail/v/0.0.0 snappymail/v/{$package->version}")) {_' /tmp/release.php; \
    test "$(grep -Fxc "$replacement" /tmp/release.php)" = 1; \
    cp /tmp/release.php cli/release.php
# Package the reviewed, committed TypeScript artifacts; CI proves they match ui/.
RUN php release.php --frontend-dist
RUN set -eux; \
    VERSION=$( ls build/dist/releases/webmail ); \
    ls -al build/dist/releases/webmail/$VERSION/snappymail-$VERSION.tar.gz; \
    mkdir -p /snappymail; \
    tar -zxvf build/dist/releases/webmail/$VERSION/snappymail-$VERSION.tar.gz -C /snappymail; \
    find /snappymail -type d -exec chmod 550 {} \; ; \
    find /snappymail -type f -exec chmod 440 {} \; ; \
    find /snappymail/data -type d -exec chmod 750 {} \; ; \
    # Keep operator documentation and in-place updater out of the web root.
    rm -v /snappymail/README.md /snappymail/_include.php /snappymail/docs/release.md /snappymail/cli/upgrade.sh; \
    rmdir /snappymail/docs /snappymail/cli

FROM rust:1.93.0-alpine3.23@sha256:69d7b9d9aeaf108a1419d9a7fcf7860dcc043e9dbd1ab7ce88e44228774d99e9 AS rust-builder
RUN apk add --no-cache musl-dev
WORKDIR /build
COPY crates/snappy-ai-proxy/Cargo.toml crates/snappy-ai-proxy/Cargo.lock ./
COPY crates/snappy-ai-proxy/src ./src
RUN cargo build --release --locked

# Inspired by the original Rainloop dockerfile from youtous on GitLab
FROM php:8.5-fpm-alpine@sha256:64535609509e0fd5c8529359e6b599a68ce42089defd565f7881efdae7687cea AS runtime

# Install dependencies such as nginx
# GNU Wget is required by cli/upgrade.sh for HTTPS-only redirect handling.
RUN apk add --no-cache ca-certificates nginx supervisor bash wget

# Install PHP extensions. OPcache is non-optional and built into PHP 8.5;
# its FPM settings are enabled and verified below in the final image.

# apcu
RUN set -eux; \
    apk add --no-cache --virtual .build-dependencies $PHPIZE_DEPS; \
    pecl install apcu-5.1.28; \
    docker-php-ext-enable apcu; \
    docker-php-source delete; \
    apk del .build-dependencies;

# gd
RUN set -eux; \
    apk add --no-cache freetype libjpeg-turbo libpng; \
    apk add --no-cache --virtual .deps freetype-dev libjpeg-turbo-dev libpng-dev; \
    docker-php-ext-configure gd --with-freetype --with-jpeg; \
    docker-php-ext-install gd; \
    apk del .deps

# gmagick
# RUN set -eux; \
#     apk add --no-cache graphicsmagick libgomp; \
#     apk add --no-cache --virtual .deps graphicsmagick-dev libtool; \
#     apk add --no-cache --virtual .build-dependencies $PHPIZE_DEPS; \
#     pecl install gmagick-2.0.6RC1; \
#     docker-php-ext-enable gmagick; \
#     docker-php-source delete; \
#     apk del .build-dependencies; \
#     apk del .deps

# gnupg
RUN set -eux; \
    apk add --no-cache gnupg gpgme; \
    apk add --no-cache --virtual .deps gpgme-dev; \
    apk add --no-cache --virtual .build-dependencies $PHPIZE_DEPS; \
    pecl install gnupg-1.5.4; \
    docker-php-ext-enable gnupg; \
    docker-php-source delete; \
    apk del .build-dependencies; \
    apk del .deps

# imagick
RUN set -eux; \
    apk add --no-cache imagemagick libgomp; \
    apk add --no-cache --virtual .deps imagemagick-dev; \
    apk add --no-cache --virtual .build-dependencies $PHPIZE_DEPS; \
    echo | pecl install imagick-3.8.1; \
    docker-php-ext-enable imagick; \
    docker-php-source delete; \
    apk del .build-dependencies; \
    apk del .deps

# intl
RUN set -eux; \
    apk add --no-cache icu-libs; \
    apk add --no-cache --virtual .deps icu-dev; \
    docker-php-ext-configure intl; \
    docker-php-ext-install intl; \
    apk del .deps

# ldap
RUN set -eux; \
    apk add --no-cache libldap; \
    apk add --no-cache --virtual .deps openldap-dev; \
    docker-php-ext-configure ldap; \
    docker-php-ext-install ldap; \
    apk del .deps

# mysql
RUN docker-php-ext-install pdo_mysql

# postgres
RUN set -eux; \
    apk add --no-cache postgresql-libs; \
    apk add --no-cache --virtual .deps postgresql-dev; \
    docker-php-ext-install pdo_pgsql; \
    apk del .deps

# redis
RUN set -eux; \
    apk add --no-cache liblzf zstd-libs; \
    apk add --no-cache --virtual .deps zstd-dev; \
    apk add --no-cache --virtual .build-dependencies $PHPIZE_DEPS; \
    # PHP 8.5 removed ext/standard/php_smart_string.h; 3.2.16 cannot compile. \
    pecl install igbinary-3.2.17RC1; \
    docker-php-ext-enable igbinary; \
    pecl install --configureoptions 'enable-redis-igbinary="yes" enable-redis-lzf="yes" enable-redis-zstd="yes"' redis-6.3.0; \
    docker-php-ext-enable redis; \
    docker-php-source delete; \
    apk del .build-dependencies; \
    apk del .deps

# sqlite
RUN set -eux; \
    apk add --no-cache sqlite-libs; \
    apk add --no-cache --virtual .deps sqlite-dev; \
    docker-php-ext-install pdo_sqlite; \
    apk del .deps

# tidy
RUN set -eux; \
    apk add --no-cache tidyhtml; \
    apk add --no-cache --virtual .deps tidyhtml-dev; \
    docker-php-ext-install tidy; \
    apk del .deps

# uuid
RUN set -eux; \
    apk add --no-cache libuuid; \
    apk add --no-cache --virtual .deps util-linux-dev; \
    apk add --no-cache --virtual .build-dependencies $PHPIZE_DEPS; \
    pecl install uuid-1.3.0; \
    docker-php-ext-enable uuid; \
    docker-php-source delete; \
    apk del .build-dependencies; \
    apk del .deps

# xxtea - Manually install php8 compatible version from https://github.com/xxtea/xxtea-pecl master branch
RUN set -eux; \
    apk add --no-cache --virtual .build-dependencies $PHPIZE_DEPS; \
    wget -q https://github.com/xxtea/xxtea-pecl/tarball/3f5888a29045e12301254151737c5dab4523a1c1 -O xxtea.tar; \
    echo '9cbfd9c27255767deb26ddedf69e738d401d88ac9762d82c8510f9768842ca18  xxtea.tar' | sha256sum -c -; \
    tar -C /usr/src -xvf xxtea.tar; \
    cd /usr/src/xxtea-xxtea-pecl-3f5888a; \
    phpize; \
    ./configure --with-php-config=/usr/local/bin/php-config --enable-xxtea=yes; \
    make install; \
    docker-php-ext-enable xxtea; \
    cd -; \
    rm -fv xxtea.tar; \
    rm -rfv /usr/src/xxtea*; \
    apk del .build-dependencies;

# zip
RUN set -eux; \
    apk add --no-cache libzip; \
    apk add --no-cache --virtual .deps libzip-dev; \
    docker-php-ext-install zip; \
    apk del .deps

# Install snappymail
# The 'www-data' user/group in alpine is 82:82. The 'nginx' user/group in alpine is 101:101, and is part of www-data group
COPY --chown=www-data:www-data --from=builder /snappymail /snappymail
# Use a custom snappymail data folder
RUN mv -v /snappymail/data /var/lib/snappymail;
# Setup configs and the unprivileged account used by optional streaming.
COPY --chown=root:root .docker/release/files /
RUN set -eux; \
    addgroup -S snappy-ai-proxy; \
    adduser -S -D -H -G snappy-ai-proxy -s /sbin/nologin snappy-ai-proxy; \
    mkdir -p /etc/supervisor.d; \
    chown www-data:www-data /snappymail/include.php; \
    chmod 440 /snappymail/include.php; \
    # Git for Windows may check out executable scripts with CRLF endings. \
    for file in /entrypoint.sh /supervisor.conf /etc/nginx/nginx.conf /usr/local/etc/php-fpm.d/php-fpm.conf; do \
        tr -d '\r' < "$file" > "$file.tmp"; \
        cat "$file.tmp" > "$file"; \
        rm "$file.tmp"; \
    done; \
    chmod +x /entrypoint.sh; \
    # Disable the built-in php-fpm configs, since we're using our own config
    mv -v /usr/local/etc/php-fpm.d/docker.conf /usr/local/etc/php-fpm.d/docker.conf.disabled; \
    mv -v /usr/local/etc/php-fpm.d/www.conf /usr/local/etc/php-fpm.d/www.conf.disabled; \
    mv -v /usr/local/etc/php-fpm.d/zz-docker.conf /usr/local/etc/php-fpm.d/zz-docker.conf.disabled;

# Verify the runtime filesystem, including the effective safe rollout settings.
RUN php -r 'if (!extension_loaded("Zend OPcache")) { fwrite(STDERR, "OPcache is not loaded\n"); exit(1); } foreach (["opcache.enable" => true, "opcache.enable_cli" => false, "opcache.validate_timestamps" => true, "opcache.save_comments" => true] as $name => $expected) { if (filter_var(ini_get($name), FILTER_VALIDATE_BOOL) !== $expected) { fwrite(STDERR, "Unexpected $name setting\n"); exit(1); } }'

# The official Rust Alpine image has no 386 manifest. Keep 386 explicitly
# PHP-only instead of silently dropping it or pretending the sidecar exists.
FROM runtime AS runtime-with-ai
COPY --chown=root:root --from=rust-builder /build/target/release/snappy-ai-proxy /usr/local/bin/snappy-ai-proxy
RUN chmod 755 /usr/local/bin/snappy-ai-proxy

FROM runtime-with-ai AS runtime-amd64
FROM runtime-with-ai AS runtime-arm64
FROM runtime AS runtime-386
FROM runtime-${TARGETARCH} AS selected-runtime

# Reset inherited image metadata (php:fpm exposes 9000) without changing the tested filesystem.
FROM scratch AS final
COPY --from=selected-runtime / /
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PHP_INI_DIR=/usr/local/etc/php
LABEL org.label-schema.description="SnappyMail webmail client image using nginx, php-fpm and an optional Rust sidecar on Alpine"

USER root
WORKDIR /snappymail
VOLUME /var/lib/snappymail
EXPOSE 8888
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 CMD wget -q -T 3 -O /dev/null http://127.0.0.1:8888/healthz || exit 1
ENTRYPOINT []
CMD ["/entrypoint.sh"]
