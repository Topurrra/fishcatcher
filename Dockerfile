# Static site (site/) served by nginx. No build step: the pages are plain HTML.
# The unprivileged image runs nginx as the non-root "nginx" user and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine

# Our server config (gzip, cache headers, pretty-URL fallback, security headers).
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

# The site itself.
COPY site/ /usr/share/nginx/html/

EXPOSE 8080
