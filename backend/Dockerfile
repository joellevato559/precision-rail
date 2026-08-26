FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm config set registry https://registry.npmjs.org/ && npm install --omit=dev --no-package-lock
COPY . .
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/index.js"]
