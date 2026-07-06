const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let licenses = {}; // Yahan tumhara data memory mein rahega

app.get('/panel', (req, res) => {
    res.send(`<h1>Mafia Panel</h1><form method="POST" action="/add">Serial: <input name="serial"><br>Days: <input name="days"><br><button>Add/Update</button></form>`);
});

app.post('/add', (req, res) => {
    licenses[req.body.serial] = { expires: Date.now() + (req.body.days * 86400000) };
    res.send("Updated! <a href='/panel'>Back</a>");
});

app.post('/check', (req, res) => {
    const serial = req.body.data ? req.body.data.serial : null;
    if (licenses[serial] && Date.now() < licenses[serial].expires) {
        res.json({ active: true });
    } else {
        res.json({ active: false });
    }
});

app.listen(3000);
