import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import "./App.css";

const API = "http://localhost:5000/api";

const TIME_SLOTS = [
  "09:00 AM",
  "10:00 AM",
  "11:00 AM",
  "12:00 PM",
  "01:00 PM",
  "02:00 PM",
  "03:00 PM",
  "04:00 PM",
];

const EMPTY_FORM = { name: "", email: "", password: "" };

function getError(error) {
  return (
    error.response?.data?.message ||
    "Unable to connect to CareQueue. Check whether the backend is running."
  );
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z"));
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function statusClass(status) {
  return (status || "Waiting").toLowerCase().replace(/\s+/g, "-");
}

function App() {
  const [mode, setMode] = useState("login");
  const [page, setPage] = useState("dashboard");
  const [form, setForm] = useState(EMPTY_FORM);
  const [token, setToken] = useState(() => localStorage.getItem("cqToken") || "");
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("cqUser") || "null");
    } catch {
      return null;
    }
  });

  const [services, setServices] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [staffAppointments, setStaffAppointments] = useState([]);
  const [students, setStudents] = useState([]);
  const [stats, setStats] = useState(null);

  const [selectedService, setSelectedService] = useState("");
  const [selectedSlot, setSelectedSlot] = useState(TIME_SLOTS[0]);
  const [serviceForm, setServiceForm] = useState({ name: "", description: "" });
  const [editingService, setEditingService] = useState(null);

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("success");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const isAuthenticated = Boolean(token && user);
  const isAdmin = user?.role === "admin";
  const isStaff = user?.role === "staff" || isAdmin;

  const authHeaders = useCallback(
    () => ({ headers: { Authorization: `Bearer ${token}` } }),
    [token]
  );

  const notify = (text, type = "success") => {
    setMessage(text);
    setMessageType(type);
  };

  const clearMessage = () => setMessage("");

  const logout = useCallback((notice = "") => {
    localStorage.removeItem("cqToken");
    localStorage.removeItem("cqUser");
    setToken("");
    setUser(null);
    setAppointments([]);
    setStaffAppointments([]);
    setStudents([]);
    setStats(null);
    setPage("dashboard");
    setMode("login");
    setForm(EMPTY_FORM);
    setMessage(notice);
    setMessageType("info");
  }, []);

  const loadServices = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/services`);
      setServices(response.data.services || []);
    } catch (error) {
      notify(getError(error), "error");
    }
  }, []);

  const loadAppointments = useCallback(async () => {
    if (!token || !user) return;
    try {
      const response = await axios.get(
        `${API}/appointments/mine`,
        authHeaders()
      );
      setAppointments(response.data.appointments || []);
    } catch (error) {
      if (error.response?.status === 401) {
        logout("Your session expired. Please log in again.");
      } else {
        notify(getError(error), "error");
      }
    }
  }, [token, user, authHeaders, logout]);

  const loadStaffAppointments = useCallback(async () => {
    if (!token || !isStaff) return;
    try {
      const response = await axios.get(
        `${API}/staff/appointments`,
        authHeaders()
      );
      setStaffAppointments(response.data.appointments || []);
    } catch (error) {
      notify(getError(error), "error");
    }
  }, [token, isStaff, authHeaders]);

  const loadAdminData = useCallback(async () => {
    if (!token || !isAdmin) return;
    try {
      const [statsResponse, studentsResponse, appointmentsResponse] =
        await Promise.all([
          axios.get(`${API}/admin/stats`, authHeaders()),
          axios.get(`${API}/admin/students`, authHeaders()),
          axios.get(`${API}/staff/appointments`, authHeaders()),
        ]);

      setStats(statsResponse.data.stats || null);
      setStudents(studentsResponse.data.students || []);
      setStaffAppointments(appointmentsResponse.data.appointments || []);
    } catch (error) {
      notify(getError(error), "error");
    }
  }, [token, isAdmin, authHeaders]);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  useEffect(() => {
    if (!isAuthenticated) {
      setPage("dashboard");
      return;
    }

    if (page === "auth") setPage("dashboard");

    if (isAdmin) {
      loadAdminData();
    } else {
      loadAppointments();
      if (isStaff) loadStaffAppointments();
    }
  }, [
    isAuthenticated,
    isAdmin,
    isStaff,
    page,
    loadAppointments,
    loadStaffAppointments,
    loadAdminData,
  ]);

  const authenticate = async (event) => {
    event.preventDefault();
    clearMessage();

    if (mode === "register") {
      if (!form.name.trim() || !form.email.trim() || form.password.length < 8) {
        notify("Enter your name, email and a password of at least 8 characters.", "error");
        return;
      }

      setLoading(true);
      try {
        const response = await axios.post(`${API}/auth/register`, {
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
        });

        notify(response.data.message || "Registration successful. Please log in.");
        setMode("login");
        setForm({ name: "", email: form.email, password: "" });
      } catch (error) {
        notify(getError(error), "error");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!form.email.trim() || !form.password) {
      notify("Enter your email and password.", "error");
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(`${API}/auth/login`, {
        email: form.email.trim(),
        password: form.password,
      });

      const loggedInUser = response.data.user;
      if (!loggedInUser || !response.data.token) {
        throw new Error("The server returned an invalid login response.");
      }

      localStorage.setItem("cqToken", response.data.token);
      localStorage.setItem("cqUser", JSON.stringify(loggedInUser));

      setToken(response.data.token);
      setUser(loggedInUser);
      setPage("dashboard");
      setForm(EMPTY_FORM);
      notify(`Welcome back, ${loggedInUser.name}!`);
    } catch (error) {
      notify(error.response ? getError(error) : error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const bookAppointment = async (event) => {
    event.preventDefault();
    clearMessage();

    if (!selectedService || !selectedSlot) {
      notify("Please choose a service and time slot.", "error");
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(
        `${API}/appointments`,
        { service: selectedService, slot: selectedSlot },
        authHeaders()
      );

      notify(
        `${response.data.message} Your queue number is ${
          response.data.appointment?.queue_position ?? "assigned"
        }.`
      );
      await loadAppointments();
      setPage("appointments");
    } catch (error) {
      notify(getError(error), "error");
    } finally {
      setLoading(false);
    }
  };

  const cancelAppointment = async (id) => {
    if (!window.confirm("Are you sure you want to cancel this appointment?")) {
      return;
    }

    setBusyId(id);
    clearMessage();
    try {
      const response = await axios.patch(
        `${API}/appointments/${id}/cancel`,
        {},
        authHeaders()
      );
      notify(response.data.message || "Appointment cancelled.");
      await loadAppointments();
    } catch (error) {
      notify(getError(error), "error");
    } finally {
      setBusyId(null);
    }
  };

  const updateStatus = async (id, status) => {
    setBusyId(id);
    clearMessage();
    try {
      const response = await axios.patch(
        `${API}/staff/appointments/${id}/status`,
        { status },
        authHeaders()
      );
      notify(response.data.message || "Appointment status updated.");

      if (isAdmin) {
        await loadAdminData();
      } else {
        await loadStaffAppointments();
      }
    } catch (error) {
      notify(getError(error), "error");
    } finally {
      setBusyId(null);
    }
  };

  const saveService = async (event) => {
    event.preventDefault();
    if (!serviceForm.name.trim()) {
      notify("Enter a service name.", "error");
      return;
    }

    setLoading(true);
    clearMessage();
    try {
      if (editingService) {
        await axios.patch(
          `${API}/admin/services/${editingService.id}`,
          {
            name: serviceForm.name.trim(),
            description: serviceForm.description.trim(),
          },
          authHeaders()
        );
        notify("Service updated successfully.");
      } else {
        await axios.post(
          `${API}/admin/services`,
          {
            name: serviceForm.name.trim(),
            description: serviceForm.description.trim(),
          },
          authHeaders()
        );
        notify("Service added successfully.");
      }

      setServiceForm({ name: "", description: "" });
      setEditingService(null);
      await loadServices();
      await loadAdminData();
    } catch (error) {
      notify(getError(error), "error");
    } finally {
      setLoading(false);
    }
  };

  const startEditService = (service) => {
    setEditingService(service);
    setServiceForm({
      name: service.name,
      description: service.description || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const navigate = (nextPage) => {
    clearMessage();
    setPage(nextPage);

    if (nextPage === "appointments") loadAppointments();
    if (nextPage === "staff") loadStaffAppointments();
    if (nextPage === "admin") loadAdminData();
    if (nextPage === "services-admin") loadServices();
  };

  const waitingCount = appointments.filter(
    (item) => item.status === "Waiting" || item.status === "In Progress"
  ).length;

  if (!isAuthenticated) {
    return (
      <div className="auth-screen">
        <section className="auth-visual">
          <div className="brand brand-light">
            <div className="brand-symbol">CQ</div>
            <span>CareQueue</span>
          </div>

          <div className="auth-hero">
            <span className="eyebrow">YOUR CAMPUS, SIMPLIFIED</span>
            <h1>Less waiting.<br />More doing.</h1>
            <p>
              Book campus services, keep track of your queue, and spend more
              time on what matters.
            </p>

            <div className="visual-stats">
              <div><strong>01</strong><span>Book a service</span></div>
              <div><strong>02</strong><span>Track your queue</span></div>
              <div><strong>03</strong><span>Get things done</span></div>
            </div>
          </div>

          <div className="auth-bottom">
            <span className="status-dot" /> Your campus service companion
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-card">
            <div className="brand brand-dark">
              <div className="brand-symbol">CQ</div>
              <span>CareQueue</span>
            </div>

            <span className="eyebrow auth-eyebrow">
              {mode === "login" ? "WELCOME BACK" : "GET STARTED"}
            </span>
            <h2>{mode === "login" ? "Sign in to continue" : "Create your account"}</h2>
            <p className="muted">
              {mode === "login"
                ? "Access your campus services in one place."
                : "Register as a student to start booking services."}
            </p>

            {message && (
              <div className={`alert alert-${messageType}`}>{message}</div>
            )}

            <form onSubmit={authenticate} className="auth-form">
              {mode === "register" && (
                <label>
                  Full name
                  <input
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    placeholder="Enter your full name"
                    autoComplete="name"
                    required
                  />
                </label>
              )}

              <label>
                Email address
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  placeholder="you@college.edu"
                  autoComplete="email"
                  required
                />
              </label>

              <label>
                Password
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  placeholder={mode === "register" ? "At least 8 characters" : "Enter your password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  minLength={mode === "register" ? 8 : undefined}
                  required
                />
              </label>

              <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
                {loading ? "Please wait..." : mode === "login" ? "Sign in →" : "Create account →"}
              </button>
            </form>

            <div className="auth-switch">
              {mode === "login" ? "New to CareQueue?" : "Already have an account?"}
              {" "}
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setMode(mode === "login" ? "register" : "login");
                  clearMessage();
                }}
              >
                {mode === "login" ? "Create account" : "Sign in"}
              </button>
            </div>

            <p className="security-note">
              <span>🔒</span> Secure sign-in · Your campus, one place
            </p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand brand-light sidebar-brand">
          <div className="brand-symbol">CQ</div>
          <span>CareQueue</span>
        </div>

        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav">
          <button className={page === "dashboard" ? "nav-item active" : "nav-item"} onClick={() => navigate("dashboard")}>
            <span>◫</span> Overview
          </button>
          {!isAdmin && (
            <>
              <button className={page === "book" ? "nav-item active" : "nav-item"} onClick={() => navigate("book")}>
                <span>＋</span> Book a visit
              </button>
              <button className={page === "appointments" ? "nav-item active" : "nav-item"} onClick={() => navigate("appointments")}>
                <span>▤</span> My appointments
              </button>
            </>
          )}
          {isStaff && (
            <button className={page === "staff" ? "nav-item active" : "nav-item"} onClick={() => navigate("staff")}>
              <span>▦</span> Staff desk
            </button>
          )}
          {isAdmin && (
            <>
              <button className={page === "admin" ? "nav-item active" : "nav-item"} onClick={() => navigate("admin")}>
                <span>◈</span> Administration
              </button>
              <button className={page === "services-admin" ? "nav-item active" : "nav-item"} onClick={() => navigate("services-admin")}>
                <span>⚙</span> Manage services
              </button>
            </>
          )}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-help">
            <div className="help-icon">?</div>
            <strong>Need assistance?</strong>
            <p>Your campus services are just a few clicks away.</p>
          </div>
          <div className="sidebar-user">
            <div className="avatar">{user?.name?.charAt(0)?.toUpperCase() || "U"}</div>
            <div className="user-details">
              <strong>{user?.name}</strong>
              <span>{user?.role || "student"}</span>
            </div>
            <button className="logout-icon" title="Sign out" onClick={() => logout("You have signed out.")}>↗</button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">CareQueue <span>/</span> {page === "services-admin" ? "Manage services" : page === "staff" ? "Staff desk" : page === "admin" ? "Administration" : page === "book" ? "Book a visit" : page === "appointments" ? "My appointments" : "Overview"}</div>
          <div className="topbar-right">
            <span className="live-indicator"><i /> Campus services</span>
            <div className="avatar avatar-small">{user?.name?.charAt(0)?.toUpperCase() || "U"}</div>
          </div>
        </header>

        <div className="content-area">
          {message && (
            <div className={`alert alert-${messageType}`}>
              <span>{message}</span>
              <button onClick={clearMessage} aria-label="Dismiss message">×</button>
            </div>
          )}

          {page === "dashboard" && (
            <>
              <section className="welcome-row">
                <div>
                  <span className="eyebrow">{isAdmin ? "ADMINISTRATION" : isStaff ? "STAFF WORKSPACE" : "YOUR CAMPUS, AT A GLANCE"}</span>
                  <h1>{isAdmin ? "Administration overview" : `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${user?.name?.split(" ")[0] || "there"}.`}</h1>
                  <p className="muted">{isAdmin ? "Monitor campus services and appointment activity." : "Everything you need for a smoother campus day."}</p>
                </div>
                {!isAdmin && (
                  <button className="btn btn-primary" onClick={() => navigate("book")}>＋ Book an appointment</button>
                )}
                {isAdmin && (
                  <button className="btn btn-primary" onClick={() => navigate("services-admin")}>＋ Manage services</button>
                )}
              </section>

              {isAdmin ? (
                <section className="stat-grid">
                  <StatCard label="Total students" value={stats?.students ?? "—"} icon="♙" tone="blue" />
                  <StatCard label="Appointments" value={stats?.appointments ?? "—"} icon="▤" tone="violet" />
                  <StatCard label="Campus services" value={stats?.services ?? services.length} icon="◈" tone="teal" />
                  <StatCard label="In progress" value={stats?.["In Progress"] ?? "—"} icon="◷" tone="orange" />
                </section>
              ) : (
                <section className="stat-grid">
                  <StatCard label="My appointments" value={appointments.length} icon="▤" tone="blue" />
                  <StatCard label="Active queue items" value={waitingCount} icon="◷" tone="teal" />
                  <StatCard label="Available services" value={services.length} icon="◈" tone="violet" />
                </section>
              )}

              <section className="hero-banner">
                <div className="hero-copy">
                  <span className="hero-tag">{isAdmin ? "CAMPUS OPERATIONS" : "A BETTER CAMPUS EXPERIENCE"}</span>
                  <h2>{isAdmin ? "Your campus. One clear view." : "Your time is valuable."}</h2>
                  <p>{isAdmin ? "Keep services organized and appointments moving smoothly." : "Skip unnecessary queues. Book a service and follow your appointment status from your dashboard."}</p>
                  <button className="btn btn-white" onClick={() => navigate(isAdmin ? "admin" : isStaff ? "staff" : "book")}>
                    {isAdmin ? "Open administration →" : isStaff ? "Open staff desk →" : "Get started →"}
                  </button>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="art-circle circle-one" />
                  <div className="art-circle circle-two" />
                  <div className="art-calendar">
                    <div className="calendar-top"><span /><span /><span /></div>
                    <div className="calendar-check">✓</div>
                    <strong>You're all set</strong>
                    <small>Appointment ready</small>
                  </div>
                  <div className="floating-check">✓</div>
                </div>
              </section>

              <section className="section-block">
                <div className="section-heading">
                  <div><h2>{isAdmin ? "Campus services" : "Explore campus services"}</h2><p>Find the right department for your needs.</p></div>
                  {isAdmin && <button className="text-button" onClick={() => navigate("services-admin")}>Manage services →</button>}
                </div>
                <div className="service-grid">
                  {services.map((service, index) => (
                    <article className="service-card" key={service.id || service.name}>
                      <div className={`service-icon service-icon-${index % 5}`}>
                        {["⌘", "▤", "▣", "₹", "▦"][index % 5]}
                      </div>
                      <h3>{service.name}</h3>
                      <p>{service.description || "Campus support and assistance."}</p>
                      {!isAdmin && (
                        <button className="card-link" onClick={() => {
                          setSelectedService(service.name);
                          navigate("book");
                        }}>Book this service <span>→</span></button>
                      )}
                      {isAdmin && <button className="card-link" onClick={() => { startEditService(service); navigate("services-admin"); }}>Edit service <span>→</span></button>}
                    </article>
                  ))}
                  {services.length === 0 && <div className="empty-state">No services available yet.</div>}
                </div>
              </section>

              {!isAdmin && (
                <section className="section-block recent-section">
                  <div className="section-heading">
                    <div><h2>Recent appointments</h2><p>Your latest bookings and queue updates.</p></div>
                    <button className="text-button" onClick={() => navigate("appointments")}>View all →</button>
                  </div>
                  {appointments.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-icon">▤</div>
                      <h3>No appointments yet</h3>
                      <p>Book your first campus service to see updates here.</p>
                      <button className="btn btn-primary" onClick={() => navigate("book")}>Book your first visit</button>
                    </div>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Service</th><th>Time slot</th><th>Queue no.</th><th>Status</th></tr></thead>
                        <tbody>
                          {appointments.slice(0, 4).map((item) => (
                            <tr key={item.id}>
                              <td><strong>{item.service}</strong></td>
                              <td>{item.slot}</td>
                              <td><span className="queue-number">#{item.queue_position}</span></td>
                              <td><StatusPill status={item.status} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}

              {isAdmin && (
                <section className="section-block">
                  <div className="section-heading"><div><h2>Latest appointments</h2><p>Recent campus appointment activity.</p></div><button className="text-button" onClick={() => navigate("admin")}>View administration →</button></div>
                  <AppointmentTable appointments={staffAppointments.slice(0, 5)} showStudent />
                </section>
              )}
            </>
          )}

          {page === "book" && !isAdmin && (
            <>
              <section className="page-heading">
                <span className="eyebrow">NEW BOOKING</span>
                <h1>Book a campus visit</h1>
                <p className="muted">Choose a department and a convenient time slot.</p>
              </section>
              <div className="booking-layout">
                <form className="panel booking-form" onSubmit={bookAppointment}>
                  <div className="panel-heading"><div className="step-number">01</div><div><h2>Appointment details</h2><p>Tell us what you need help with.</p></div></div>
                  <label>Campus service
                    <select value={selectedService} onChange={(event) => setSelectedService(event.target.value)} required>
                      <option value="">Select a department</option>
                      {services.map((service) => <option key={service.id || service.name} value={service.name}>{service.name}</option>)}
                    </select>
                  </label>
                  <label>Preferred time slot
                    <select value={selectedSlot} onChange={(event) => setSelectedSlot(event.target.value)} required>
                      {TIME_SLOTS.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                    </select>
                  </label>
                  <div className="booking-note"><span>ⓘ</span><p>Your queue number will be assigned when you confirm. Please arrive on time.</p></div>
                  <button className="btn btn-primary btn-full" disabled={loading || services.length === 0} type="submit">{loading ? "Booking..." : "Confirm appointment →"}</button>
                </form>
                <aside className="panel booking-aside">
                  <div className="aside-icon">◷</div>
                  <h3>Before you book</h3>
                  <ul>
                    <li>Choose the department that best matches your request.</li>
                    <li>Select one of the available time slots.</li>
                    <li>Track your queue and status under My appointments.</li>
                  </ul>
                  <div className="aside-divider" />
                  <div className="mini-stat"><span>Available services</span><strong>{services.length}</strong></div>
                  <div className="mini-stat"><span>Time slots</span><strong>{TIME_SLOTS.length}</strong></div>
                </aside>
              </div>
            </>
          )}

          {page === "appointments" && !isAdmin && (
            <>
              <section className="page-heading page-heading-row">
                <div><span className="eyebrow">YOUR BOOKINGS</span><h1>My appointments</h1><p className="muted">Review your bookings and track each appointment.</p></div>
                <button className="btn btn-primary" onClick={() => navigate("book")}>＋ New appointment</button>
              </section>
              <div className="panel">
                <div className="panel-heading panel-heading-between"><div><h2>Appointment history</h2><p>{appointments.length} booking{appointments.length === 1 ? "" : "s"} in your account</p></div><button className="btn btn-secondary btn-small" onClick={loadAppointments}>↻ Refresh</button></div>
                {appointments.length === 0 ? (
                  <div className="empty-state"><div className="empty-icon">▤</div><h3>Nothing booked yet</h3><p>Your appointments will appear here after booking.</p><button className="btn btn-primary" onClick={() => navigate("book")}>Book an appointment</button></div>
                ) : (
                  <div className="table-wrap"><table><thead><tr><th>Service</th><th>Time slot</th><th>Queue number</th><th>Status</th><th>Booked on</th><th>Action</th></tr></thead>
                    <tbody>{appointments.map((item) => (
                      <tr key={item.id}>
                        <td><strong>{item.service}</strong></td><td>{item.slot}</td><td><span className="queue-number">#{item.queue_position}</span></td><td><StatusPill status={item.status} /></td><td>{formatDate(item.created_at)}</td>
                        <td>{item.status === "Waiting" ? <button className="table-action danger-text" disabled={busyId === item.id} onClick={() => cancelAppointment(item.id)}>{busyId === item.id ? "..." : "Cancel"}</button> : <span className="muted">—</span>}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                )}
              </div>
            </>
          )}

          {page === "staff" && isStaff && (
            <>
              <section className="page-heading page-heading-row">
                <div><span className="eyebrow">OPERATIONS</span><h1>Staff desk</h1><p className="muted">Review appointments and update their progress.</p></div>
                <button className="btn btn-secondary" onClick={loadStaffAppointments}>↻ Refresh queue</button>
              </section>
              <section className="stat-grid staff-stat-grid">
                <StatCard label="All appointments" value={staffAppointments.length} icon="▤" tone="blue" />
                <StatCard label="Waiting" value={staffAppointments.filter((a) => a.status === "Waiting").length} icon="◷" tone="orange" />
                <StatCard label="In progress" value={staffAppointments.filter((a) => a.status === "In Progress").length} icon="↗" tone="teal" />
                <StatCard label="Completed" value={staffAppointments.filter((a) => a.status === "Completed").length} icon="✓" tone="violet" />
              </section>
              <div className="panel">
                <div className="panel-heading"><div><h2>Appointment queue</h2><p>Update a booking when its status changes.</p></div></div>
                <AppointmentTable appointments={staffAppointments} showStudent onStatusChange={updateStatus} busyId={busyId} />
              </div>
            </>
          )}

          {page === "admin" && isAdmin && (
            <>
              <section className="page-heading page-heading-row">
                <div><span className="eyebrow">CONTROL CENTER</span><h1>Administration</h1><p className="muted">An overview of students, services and campus appointments.</p></div>
                <button className="btn btn-secondary" onClick={loadAdminData}>↻ Refresh data</button>
              </section>
              <section className="stat-grid">
                <StatCard label="Registered students" value={stats?.students ?? "—"} icon="♙" tone="blue" />
                <StatCard label="Total appointments" value={stats?.appointments ?? "—"} icon="▤" tone="violet" />
                <StatCard label="Available services" value={stats?.services ?? services.length} icon="◈" tone="teal" />
                <StatCard label="Cancelled" value={stats?.Cancelled ?? "—"} icon="×" tone="orange" />
              </section>
              <section className="section-block">
                <div className="section-heading"><div><h2>Appointment activity</h2><p>View the queue across campus departments.</p></div><button className="text-button" onClick={() => navigate("staff")}>Open staff desk →</button></div>
                <div className="panel"><AppointmentTable appointments={staffAppointments} showStudent onStatusChange={updateStatus} busyId={busyId} /></div>
              </section>
              <section className="section-block">
                <div className="section-heading"><div><h2>Registered students</h2><p>Students with a CareQueue account.</p></div><span className="count-chip">{students.length} students</span></div>
                <div className="panel">
                  {students.length === 0 ? <div className="empty-state">No student accounts found.</div> : <div className="table-wrap"><table><thead><tr><th>Student</th><th>Email</th><th>Registered</th></tr></thead><tbody>{students.map((student) => <tr key={student.id}><td><div className="person-cell"><div className="avatar avatar-table">{student.name?.charAt(0)?.toUpperCase()}</div><strong>{student.name}</strong></div></td><td>{student.email}</td><td>{formatDate(student.created_at)}</td></tr>)}</tbody></table></div>}
                </div>
              </section>
            </>
          )}

          {page === "services-admin" && isAdmin && (
            <>
              <section className="page-heading"><span className="eyebrow">SERVICE DIRECTORY</span><h1>Manage services</h1><p className="muted">Keep campus departments and their descriptions up to date.</p></section>
              <div className="admin-services-layout">
                <form className="panel service-editor" onSubmit={saveService}>
                  <div className="panel-heading"><div><h2>{editingService ? "Edit service" : "Add a service"}</h2><p>{editingService ? "Update the selected department." : "Create a new campus service."}</p></div></div>
                  <label>Service name<input value={serviceForm.name} onChange={(event) => setServiceForm({ ...serviceForm, name: event.target.value })} placeholder="e.g. Student Counselling" required /></label>
                  <label>Description<textarea value={serviceForm.description} onChange={(event) => setServiceForm({ ...serviceForm, description: event.target.value })} placeholder="What does this department help with?" rows="4" /></label>
                  <button className="btn btn-primary btn-full" type="submit" disabled={loading}>{loading ? "Saving..." : editingService ? "Save changes" : "Add service"}</button>
                  {editingService && <button className="btn btn-secondary btn-full" type="button" onClick={() => { setEditingService(null); setServiceForm({ name: "", description: "" }); }}>Cancel editing</button>}
                  <p className="form-footnote">Removing services is not enabled, so existing appointment records remain safe.</p>
                </form>
                <div className="panel service-list-panel">
                  <div className="panel-heading"><div><h2>Current services</h2><p>{services.length} department{services.length === 1 ? "" : "s"}</p></div></div>
                  <div className="managed-services">
                    {services.map((service, index) => (
                      <div className="managed-service" key={service.id || service.name}>
                        <div className={`service-icon service-icon-${index % 5}`}>◈</div>
                        <div className="managed-service-info"><strong>{service.name}</strong><p>{service.description || "No description provided."}</p></div>
                        <button className="btn btn-secondary btn-small" onClick={() => startEditService(service)}>Edit</button>
                      </div>
                    ))}
                    {services.length === 0 && <div className="empty-state">No services are available.</div>}
                  </div>
                </div>
              </div>
            </>
          )}

          {((page === "staff" && !isStaff) || (page === "admin" && !isAdmin) || (page === "services-admin" && !isAdmin) || (page === "book" && isAdmin) || (page === "appointments" && isAdmin)) && (
            <div className="panel empty-state"><div className="empty-icon">⌁</div><h3>Page not available</h3><p>Your account does not have access to this section.</p><button className="btn btn-primary" onClick={() => navigate("dashboard")}>Back to overview</button></div>
          )}

          <footer className="app-footer"><span>© {new Date().getFullYear()} CareQueue</span><span>Made for a smoother campus experience <b>✦</b></span></footer>
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value, icon, tone }) {
  return (
    <article className="stat-card">
      <div className={`stat-icon stat-${tone}`}>{icon}</div>
      <div><span>{label}</span><strong>{value}</strong></div>
    </article>
  );
}

function StatusPill({ status }) {
  return <span className={`status-pill status-${statusClass(status)}`}>{status || "Waiting"}</span>;
}

function AppointmentTable({ appointments, showStudent = false, onStatusChange, busyId }) {
  if (!appointments?.length) {
    return <div className="empty-state"><div className="empty-icon">▤</div><h3>No appointments to display</h3><p>New appointments will appear here.</p></div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {showStudent && <th>Student</th>}
            <th>Service</th><th>Time slot</th><th>Queue no.</th><th>Status</th>
            {onStatusChange && <th>Update status</th>}
            <th>Booked on</th>
          </tr>
        </thead>
        <tbody>
          {appointments.map((item) => (
            <tr key={item.id}>
              {showStudent && <td><div className="person-cell"><div className="avatar avatar-table">{item.student_name?.charAt(0)?.toUpperCase() || "S"}</div><div><strong>{item.student_name || "Student"}</strong><small>{item.student_email || ""}</small></div></div></td>}
              <td><strong>{item.service}</strong></td>
              <td>{item.slot}</td>
              <td><span className="queue-number">#{item.queue_position}</span></td>
              <td><StatusPill status={item.status} /></td>
              {onStatusChange && <td><select className="status-select" value={item.status} disabled={busyId === item.id} onChange={(event) => onStatusChange(item.id, event.target.value)}><option>Waiting</option><option>In Progress</option><option>Completed</option><option>Cancelled</option></select></td>}
              <td>{formatDate(item.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;