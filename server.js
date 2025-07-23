const https = require('https');
const fs = require('fs');
const net = require('net');
const express = require('express');
const cors = require('cors');

const HTTPS_PORT = 8081;               // HTTPS server port
const TCP_HOST = '192.168.1.178';      // Meta Quest 3 IP
const TCP_PORT = 8010;                 // TCP port of GNSS master

const app = express();
app.use(cors());

// Parse $GPHPD sentence from the multi-line GNSS data
function parseGNSSFull(messageBatch) {
    const lines = messageBatch.trim().split(/\r?\n/);
    const gphpdLine = lines.find(line => line.startsWith('$GPHPD'));
    if (!gphpdLine) {
        return { error: 'No $GPHPD sentence found' };
    }
    const fields = gphpdLine.split(',');
    // if (fields.length < 19) {
    //     return { error: 'Invalid $GPHPD sentence format' };
    // }
    return {
        type: fields[0],
        packetId: fields[1],
        time: fields[2],
        heading: parseFloat(fields[3]),
        pitch: parseFloat(fields[4]),
        roll: parseFloat(fields[5]),
        latitude: parseFloat(fields[6]),
        longitude: parseFloat(fields[7]),
        altitude: parseFloat(fields[8]),
        velocity: {
            x: parseFloat(fields[9]),
            y: parseFloat(fields[10]),
            z: parseFloat(fields[11]),
        },
        covariance: {
            x: parseFloat(fields[12]),
            y: parseFloat(fields[13]),
            z: parseFloat(fields[14]),
        },
        accuracy: parseFloat(fields[15]),
        satellitesInView: parseInt(fields[16]),
        satellitesUsed: parseInt(fields[17].split('*')[0]),
        checksum: fields[17].split('*')[1] || null,
    };
}

app.get('/geopos', (req, res) => {
    const client = new net.Socket();
    let buffer = '';
    let timeout;

    client.connect(TCP_PORT, TCP_HOST, () => {
        console.log('Connected to GNSS TCP server');
    });

    client.on('data', (data) => {
        buffer += data.toString();
        // Wait until the buffer contains $GPHPD sentence, then respond
        if (buffer.includes('$GPHPD')) {
            clearTimeout(timeout);
            client.destroy();
            const parsed = parseGNSSFull(buffer);
            res.json(parsed);
        }
    });

    client.on('error', (err) => {
        clearTimeout(timeout);
        client.destroy();
        console.error('TCP error:', err.message);
        res.status(502).json({ error: 'TCP connection error', message: err.message });
    });

    timeout = setTimeout(() => {
        client.destroy();
        res.status(504).json({ error: 'Timeout waiting for GNSS server response' });
    }, 3000);
});

// Create HTTPS server with your certs
const options = {
    key: fs.readFileSync('server.key'),
    cert: fs.readFileSync('server.cert'),
};

https.createServer(options, app).listen(HTTPS_PORT, () => {
    console.log(`HTTPS GNSS proxy listening at https://0.0.0.0:${HTTPS_PORT}/geopos`);
    console.log(`Forwarding TCP connection to ${TCP_HOST}:${TCP_PORT}`);
});