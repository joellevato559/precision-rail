FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && node -e "require('express'); console.log('express ok')"
COPY . .
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/index.js"]
