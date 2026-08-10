# Static site (site/) served by nginx. No build step: the pages are plain HTML.
FROM nginx:1.27-alpine

# Our server config (gzip, cache headers, pretty-URL fallback).
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

# The site itself.
COPY site/ /usr/share/nginx/html/

EXPOSE 80
