FROM node:current-alpine
WORKDIR /app

COPY package.json .

# RUN npm install --only=production
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000
CMD node build/run.js
