FROM node:20-bullseye

# Install native dependencies for @roamhq/wrtc
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    libx11-dev \
    libxext-dev \
    libxtst-dev \
    libxkbfile-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 19000

CMD ["node", "server.js"]
