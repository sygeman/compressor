FROM node:lts-alpine as base
WORKDIR /app
RUN apk add --no-cache ffmpeg

FROM base as dependencies

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build \
    && npm prune --production

RUN mkdir -p ./tmp/
CMD node ./dist/main.js