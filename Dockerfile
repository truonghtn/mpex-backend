FROM node:boron
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY package.json /usr/src/app/
COPY . /usr/src/app
RUN npm install -g typescript typings && npm install && typings install
RUN tsc
EXPOSE 7615
CMD [ "node", "app.js" ]