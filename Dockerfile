FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV PORT=4000
EXPOSE 4000

CMD ["node", "src/index.js"]
