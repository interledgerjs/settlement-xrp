FROM node:current-alpine
WORKDIR /app
COPY package.json /app
RUN npm install
COPY . /app
CMD npm run build && node ./build/run.js
EXPOSE 3000
