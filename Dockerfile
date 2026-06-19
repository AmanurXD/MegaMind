FROM node:20-alpine

WORKDIR /app

COPY --chown=node:node package.json megamind.js ./

ENV NODE_ENV=production

EXPOSE 3000

USER node

CMD ["node", "megamind.js"]
