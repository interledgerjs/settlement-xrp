FROM node:current-alpine
WORKDIR /app

COPY package.json /app

# RUN npm install --only=production
RUN npm install

COPY . /app
RUN npm run build
CMD node ./build/run.js
EXPOSE 3000
