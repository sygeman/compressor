FROM node:lts-alpine as base
WORKDIR /app
RUN apk add --no-cache ffmpeg

FROM base as dependencies

COPY package*.json ./
RUN npm ci

COPY . .

RUN mkdir -p ./tmp/
CMD npm run start