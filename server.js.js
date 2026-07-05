const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Yeh route aapke browser ke liye hai
app.get('/panel', (req, res) => {
    res.send(`
        <h1>License Panel</h1>
        <form method="POST" action="/add">
            <input type="text" name="serial" placeholder="Serial Number">
            <input type="text" name="days" placeholder="Days">
            <button type="submit">Add License</button>
        </form>
    `);
});

// Yeh route data add karne ke liye hai
app.post('/add', (req, res) => {
    console.log("New Serial:", req.body.serial);
    res.send("Serial added! Wapis jao: <a href='/panel'>Back</a>");
});

// Yeh route module check ke liye hai
app.post('/check', (req, res) => {
    res.json({
        active: true,
        lease: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature",
        expiresAt: 2524608000000,
        reason: "ok"
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server chal raha hai"));
