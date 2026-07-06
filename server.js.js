const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let licenses = { "R8YXC04WHNM": { expires: 2524608000000 } };

app.get('/panel', (req, res) => {
    res.send(`<h1>License Panel</h1><form method="POST" action="/add"><input name="serial" placeholder="Serial"><input name="days" placeholder="Days"><button type="submit">Add</button></form>`);
});

app.post('/add', (req, res) => {
    licenses[req.body.serial] = { expires: Date.now() + (req.body.days * 86400000) };
    res.send("Added! <a href='/panel'>Back</a>");
});

app.post('/check', (req, res) => {
    const serial = req.body.data ? req.body.data.serial : null;
    if (serial && licenses[serial]) {
        res.json({ active: true, lease: "VALID", expiresAt: licenses[serial].expires });
    } else {
        res.json({ active: false });
    }
});

app.listen(process.env.PORT || 3000);
