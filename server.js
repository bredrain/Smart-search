import 'dotenv/config';
import express from 'express';

const PORT = process.env.SERVICE_PORT || process.env.PORT || 3030;

const server = express();
server.use(express.json());
server.use(express.static("public"));


server.listen(PORT, () => {
    console.log("http://localhost:" + PORT);
});