FROM node:20-alpine as base
WORKDIR /app
RUN apk add --no-cache ffmpeg

FROM base as dependencies

COPY package*.json ./
COPY main.js ./
RUN npm ci

CMD npm run start