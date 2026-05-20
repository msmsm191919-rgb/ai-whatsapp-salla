# Use Node.js LTS (Long Term Support) image
FROM node:18-alpine

# Set working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json first (for efficient caching)
COPY package*.json ./

# Install dependencies (only production ones to save space)
RUN npm ci --only=production

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 8095

# Define environment variables (Can be overridden by docker-compose)
ENV PORT=8095
ENV NODE_ENV=production

# Switch to non-root user for security
USER node

# Start the application using PM2 (or directly w/ node if preferred)
# We use node directly for simplicity in Docker, PM2 is often handled outside or via eco-system
CMD ["node", "app.js"]
