FROM node:20-alpine as base
WORKDIR /app
RUN apk add --no-cache ffmpeg

FROM base as dependencies

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install --production
RUN npm install --global tsx

COPY . .
RUN mkdir tmp
CMD npm run start