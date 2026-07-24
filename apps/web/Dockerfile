FROM node:18-alpine

WORKDIR /app

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the frontend source code
COPY . .

# Expose Vite default dev port
EXPOSE 5173

# Start Vite server, bound to all interfaces
CMD ["npm", "run", "dev", "--", "--host"]
