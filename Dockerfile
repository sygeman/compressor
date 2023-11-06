FROM node:21-alpine as base
WORKDIR /app
RUN apk add --no-cache ffmpeg

FROM base as dependencies

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install --production

COPY . .
RUN mkdir tmp
CMD npm run start