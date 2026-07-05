const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Yeh raha aapka "License Panel" ka design (HTML)
app.get('/panel', (req, res) => {
    res.send(`
        <h1>License Panel</h1>
        <ul>
            <li>DK030A95NEU006813: active (30 days) <a href="#">Toggle</a></li>
            <li>R8YXC04WHNM: active (5 days) <a href="#">Toggle</a></li>
        </ul>
        <form method="POST" action="/add">
            <input type="text" name="serial" placeholder="Serial">
            <input type="text" name="days" placeholder="Days">
            <button type="submit">Add</button>
        </form>
    `);
});

// Module yahan se check karega
app.post('/check', (req, res) => {
    res.json({
        active: true,
        lease: "fake_lease_data",
        expiresAt: 2524608000000,
        reason: "ok"
    });
});

app.listen(3000);
