require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("JWT_SECRET is missing from .env");
  process.exit(1);
}

app.use(cors());
app.use(express.json());

const db = new Database("carequeue.db");
db.pragma("foreign_keys = ON");

// DATABASE TABLES
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    service_id INTEGER NOT NULL,
    slot TEXT NOT NULL,
    queue_position INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'Waiting',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(service_id) REFERENCES services(id)
  );
`);

// DEFAULT CAMPUS SERVICES
const defaultServices = [
  ["IT Support", "Technical support and computer-related issues"],
  ["Library", "Library assistance and book services"],
  ["Examination Cell", "Examination forms and result queries"],
  ["Accounts", "Fees, payments and account-related queries"],
  ["Academic Office", "Academic records and student assistance"]
];

const insertService = db.prepare(
  "INSERT OR IGNORE INTO services (name, description) VALUES (?, ?)"
);

for (const service of defaultServices) {
  insertService.run(...service);
}

// AUTHENTICATION MIDDLEWARE
function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Please log in to continue."
    });
  }

  try {
    const token = header.split(" ")[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Session expired. Please log in again."
    });
  }
}

function requireStaff(req, res, next) {
  if (!["admin", "staff"].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Staff access required."
    });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Administrator access required."
    });
  }
  next();
}

// HEALTH CHECK
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "CareQueue API is running."
  });
});

// LIST SERVICES
app.get("/api/services", (req, res) => {
  const services = db.prepare(
    "SELECT id, name, description FROM services ORDER BY name"
  ).all();

  res.json({ success: true, services });
});

// REGISTER STUDENT
app.post("/api/auth/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (
      !name?.trim() ||
      !email?.trim() ||
      typeof password !== "string" ||
      password.length < 8
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter your name, valid email and password of at least 8 characters."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = db.prepare(`
      INSERT INTO users (name, email, password, role)
      VALUES (?, ?, ?, 'student')
    `).run(name.trim(), normalizedEmail, hashedPassword);

    res.status(201).json({
      success: true,
      message: "Registration successful. Please log in.",
      userId: result.lastInsertRowid
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists."
      });
    }
    next(error);
  }
});

// LOGIN
app.post("/api/auth/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email?.trim() || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required."
      });
    }

    const user = db.prepare(
      "SELECT * FROM users WHERE email = ?"
    ).get(email.trim().toLowerCase());

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({
        success: false,
        message: "Incorrect email or password."
      });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({
      success: true,
      message: "Login successful.",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

// ADMIN DASHBOARD STATISTICS
app.get(
  "/api/admin/stats",
  authenticate,
  requireAdmin,
  (req, res) => {
    const students = db.prepare(
      "SELECT COUNT(*) AS total FROM users WHERE role = 'student'"
    ).get().total;

    const appointments = db.prepare(
      "SELECT COUNT(*) AS total FROM appointments"
    ).get().total;

    const counts = db.prepare(`
      SELECT status, COUNT(*) AS total
      FROM appointments
      GROUP BY status
    `).all();

    const statusCounts = {
      Waiting: 0,
      "In Progress": 0,
      Completed: 0,
      Cancelled: 0
    };

    counts.forEach(item => {
      statusCounts[item.status] = item.total;
    });

    const serviceCount = db.prepare(
      "SELECT COUNT(*) AS total FROM services"
    ).get().total;

    res.json({
      success: true,
      stats: {
        students,
        appointments,
        services: serviceCount,
        ...statusCounts
      }
    });
  }
);

// ADMIN: VIEW STUDENTS
app.get(
  "/api/admin/students",
  authenticate,
  requireAdmin,
  (req, res) => {
    const students = db.prepare(`
      SELECT id, name, email, created_at
      FROM users
      WHERE role = 'student'
      ORDER BY created_at DESC
    `).all();

    res.json({ success: true, students });
  }
);

// ADMIN: ADD SERVICE
app.post(
  "/api/admin/services",
  authenticate,
  requireAdmin,
  (req, res) => {
    const { name, description = "" } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Service name is required."
      });
    }

    try {
      const result = db.prepare(`
        INSERT INTO services (name, description)
        VALUES (?, ?)
      `).run(name.trim(), description.trim());

      res.status(201).json({
        success: true,
        message: "Service added successfully.",
        service: db.prepare(
          "SELECT * FROM services WHERE id = ?"
        ).get(result.lastInsertRowid)
      });
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).json({
          success: false,
          message: "This service already exists."
        });
      }
      throw error;
    }
  }
);

// ADMIN: UPDATE SERVICE
app.patch(
  "/api/admin/services/:id",
  authenticate,
  requireAdmin,
  (req, res) => {
    const { name, description } = req.body;
    const id = Number(req.params.id);

    const existing = db.prepare(
      "SELECT * FROM services WHERE id = ?"
    ).get(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Service not found."
      });
    }

    const updatedName =
      typeof name === "string" ? name.trim() : existing.name;

    const updatedDescription =
      typeof description === "string"
        ? description.trim()
        : existing.description;

    if (!updatedName) {
      return res.status(400).json({
        success: false,
        message: "Service name cannot be empty."
      });
    }

    try {
      db.prepare(`
        UPDATE services
        SET name = ?, description = ?
        WHERE id = ?
      `).run(updatedName, updatedDescription, id);

      res.json({
        success: true,
        message: "Service updated successfully."
      });
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).json({
          success: false,
          message: "Another service already uses this name."
        });
      }
      throw error;
    }
  }
);

// BOOK APPOINTMENT
app.post("/api/appointments", authenticate, (req, res) => {
  const { service, slot } = req.body;

  if (
    typeof service !== "string" ||
    typeof slot !== "string" ||
    !service.trim() ||
    !slot.trim()
  ) {
    return res.status(400).json({
      success: false,
      message: "Select a service and time slot."
    });
  }

  const serviceRecord = db.prepare(
    "SELECT id, name FROM services WHERE name = ?"
  ).get(service.trim());

  if (!serviceRecord) {
    return res.status(400).json({
      success: false,
      message: "Please select a valid campus service."
    });
  }

  const validSlots = [
    "09:00 AM", "10:00 AM", "11:00 AM",
    "12:00 PM", "01:00 PM", "02:00 PM",
    "03:00 PM", "04:00 PM"
  ];

  if (!validSlots.includes(slot.trim())) {
    return res.status(400).json({
      success: false,
      message: "Please select a valid time slot."
    });
  }

  const queuePosition = db.prepare(`
    SELECT COALESCE(MAX(queue_position), 0) + 1 AS nextPosition
    FROM appointments
    WHERE service_id = ?
      AND slot = ?
      AND status IN ('Waiting', 'In Progress')
  `).get(serviceRecord.id, slot.trim()).nextPosition;

  const result = db.prepare(`
    INSERT INTO appointments
      (user_id, service_id, slot, queue_position, status)
    VALUES (?, ?, ?, ?, 'Waiting')
  `).run(
    req.user.id,
    serviceRecord.id,
    slot.trim(),
    queuePosition
  );

  res.status(201).json({
    success: true,
    message: "Appointment booked successfully.",
    appointment: {
      id: result.lastInsertRowid,
      service: serviceRecord.name,
      slot: slot.trim(),
      queue_position: queuePosition,
      status: "Waiting"
    }
  });
});

// STUDENT: VIEW OWN APPOINTMENTS
app.get("/api/appointments/mine", authenticate, (req, res) => {
  const appointments = db.prepare(`
    SELECT
      a.id,
      a.service_id,
      s.name AS service,
      a.slot,
      a.queue_position,
      a.status,
      a.created_at
    FROM appointments a
    JOIN services s ON s.id = a.service_id
    WHERE a.user_id = ?
    ORDER BY a.created_at DESC, a.id DESC
  `).all(req.user.id);

  res.json({ success: true, appointments });
});

// STUDENT: CANCEL OWN WAITING APPOINTMENT
app.patch(
  "/api/appointments/:id/cancel",
  authenticate,
  (req, res) => {
    const id = Number(req.params.id);

    const appointment = db.prepare(`
      SELECT id, status
      FROM appointments
      WHERE id = ? AND user_id = ?
    `).get(id, req.user.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found."
      });
    }

    if (appointment.status !== "Waiting") {
      return res.status(400).json({
        success: false,
        message: "Only waiting appointments can be cancelled."
      });
    }

    db.prepare(
      "UPDATE appointments SET status = 'Cancelled' WHERE id = ?"
    ).run(id);

    res.json({
      success: true,
      message: "Appointment cancelled successfully."
    });
  }
);

// STAFF / ADMIN: VIEW ALL APPOINTMENTS
app.get(
  "/api/staff/appointments",
  authenticate,
  requireStaff,
  (req, res) => {
    const appointments = db.prepare(`
      SELECT
        a.id,
        a.user_id,
        u.name AS student_name,
        u.email AS student_email,
        s.name AS service,
        a.slot,
        a.queue_position,
        a.status,
        a.created_at
      FROM appointments a
      JOIN users u ON u.id = a.user_id
      JOIN services s ON s.id = a.service_id
      ORDER BY a.created_at DESC, a.id DESC
    `).all();

    res.json({ success: true, appointments });
  }
);

// STAFF / ADMIN: UPDATE APPOINTMENT STATUS
app.patch(
  "/api/staff/appointments/:id/status",
  authenticate,
  requireStaff,
  (req, res) => {
    const { status } = req.body;
    const allowedStatuses = [
      "Waiting",
      "In Progress",
      "Completed",
      "Cancelled"
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment status."
      });
    }

    const result = db.prepare(
      "UPDATE appointments SET status = ? WHERE id = ?"
    ).run(status, Number(req.params.id));

    if (!result.changes) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found."
      });
    }

    res.json({
      success: true,
      message: "Appointment status updated."
    });
  }
);

// NOT FOUND
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found."
  });
});

// ERROR HANDLER
app.use((error, req, res, next) => {
  console.error(error);

  res.status(500).json({
    success: false,
    message: "Something went wrong on the server."
  });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`CareQueue API running at http://localhost:${PORT}`);
});