server {
    listen %ip%:%proxy_port%;
    server_name %domain_idn% %alias_idn%;
    error_log /var/log/%web_system%/domains/%domain%.error.log error;

    location / {
        return 308 https://siap-dev.aruraharja.co.id$request_uri;
    }

    include %home%/%user%/conf/web/%domain%/nginx.conf_*;
}
