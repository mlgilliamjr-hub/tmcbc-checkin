import { useState, useEffect, useRef } from "react";

// ─── PLANNING CENTER CONFIG ────────────────────────────────────────────────────
// Replace these with your actual Planning Center App ID and Secret
// Get them at: https://api.planningcenteronline.com/oauth/applications
const PC_APP_ID = import.meta.env.VITE_PC_APP_ID || "YOUR_APP_ID";
const PC_SECRET = import.meta.env.VITE_PC_SECRET || "YOUR_SECRET";
const PC_BASE = "https://api.planningcenteronline.com";

// ─── NOTIFICATION CONFIG ───────────────────────────────────────────────────────
// These are ready to activate when you're set up with EmailJS or Twilio.
// For now they log guest info to the console and store locally.
const NOTIFICATIONS = {
  enabled: false, // flip to true when ready to activate
  recipients: [
    { name: "Pastor Gilliam", email: "tmcbcpastor@gmail.com", phone: "" },
    { name: "Greeter",        email: "GREETER_EMAIL_HERE",    phone: "" },
    // Add more recipients here as needed
  ],
  // EmailJS config (free tier -- activate later)
  emailjs: {
    serviceId:  "YOUR_EMAILJS_SERVICE_ID",
    templateId: "YOUR_EMAILJS_TEMPLATE_ID",
    publicKey:  "YOUR_EMAILJS_PUBLIC_KEY",
  },
  // Twilio config (text messages -- activate later)
  twilio: {
    accountSid: "YOUR_TWILIO_ACCOUNT_SID",
    authToken:  "YOUR_TWILIO_AUTH_TOKEN",
    fromNumber: "YOUR_TWILIO_PHONE_NUMBER",
  },
};

// Notification dispatcher -- ready to wire up, currently logs only
async function notifyTeamOfGuest(guestData) {
  const summary = `
New Guest at TMCBC -- ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}

Name:  ${guestData.firstName} ${guestData.lastName}
Type:  ${guestData.guestType === "first-time" ? "First-Time Guest" : "Returning Guest"}
Email: ${guestData.email || "Not provided"}
Phone: ${guestData.phone || "Not provided"}
How they heard: ${guestData.howHeard || "Not provided"}
Interests: ${guestData.interestedIn?.join(", ") || "None selected"}
Prayer Request: ${guestData.prayerRequest || "None"}
  `.trim();

  // Console log always (useful for testing)
  console.log("📬 Guest Notification:", summary);

  // Store locally so the report tab always has it
  const stored = JSON.parse(localStorage.getItem("tmcbc_guests") || "[]");
  stored.push({ ...guestData, timestamp: new Date().toISOString() });
  localStorage.setItem("tmcbc_guests", JSON.stringify(stored));

  if (!NOTIFICATIONS.enabled) return; // Stop here until activated

  // ── EMAIL (EmailJS) ──────────────────────────────────────────────────────
  // Uncomment and configure when ready:
  // await emailjs.send(
  //   NOTIFICATIONS.emailjs.serviceId,
  //   NOTIFICATIONS.emailjs.templateId,
  //   { to_email: NOTIFICATIONS.recipients.map(r => r.email).join(","),
  //     guest_name: `${guestData.firstName} ${guestData.lastName}`,
  //     guest_email: guestData.email,
  //     guest_phone: guestData.phone,
  //     guest_type: guestData.guestType,
  //     how_heard: guestData.howHeard,
  //     interests: guestData.interestedIn?.join(", "),
  //     prayer_request: guestData.prayerRequest,
  //     visit_date: new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
  //   },
  //   NOTIFICATIONS.emailjs.publicKey
  // );

  // ── TEXT (Twilio via your backend) ───────────────────────────────────────
  // Requires a small backend endpoint -- set up when ready:
  // await fetch("/api/notify", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({ summary, recipients: NOTIFICATIONS.recipients }),
  // });
}

// Helper: base64 auth header
const authHeader = () =>
  "Basic " + btoa(`${PC_APP_ID}:${PC_SECRET}`);

// ─── PLANNING CENTER API HELPERS ───────────────────────────────────────────────
async function pcFetch(path, options = {}) {
  const res = await fetch(`${PC_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`PC API error: ${res.status}`);
  return res.json();
}

// Pull all people from a specific service type's event
async function fetchPeopleFromPC(searchTerm = "") {
  // Search people by name
  const query = searchTerm ? `?where[search_name]=${encodeURIComponent(searchTerm)}&per_page=50` : "?per_page=100&order=last_name";
  const data = await pcFetch(`/people/v2/people${query}`);
  return data.data.map((p) => ({
    id: p.id,
    name: `${p.attributes.first_name} ${p.attributes.last_name}`,
    firstName: p.attributes.first_name,
    lastName: p.attributes.last_name,
    email: p.attributes.primary_email || "",
    phone: p.attributes.primary_phone_number || "",
    membershipType: p.attributes.membership || "Member",
    avatar: p.attributes.avatar || null,
  }));
}

// Get or create today's event in Check-ins
async function getOrCreateTodayEvent() {
  const today = new Date().toISOString().split("T")[0];
  // Look for an existing event today
  const data = await pcFetch(`/check_ins/v2/events?where[name_contains]=Sunday&per_page=10`);
  if (data.data.length > 0) return data.data[0].id;
  // Create one
  const created = await pcFetch("/check_ins/v2/events", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "Event",
        attributes: { name: `Sunday Worship — ${today}` },
      },
    }),
  });
  return created.data.id;
}

// Check someone in via Planning Center Check-Ins
async function checkInToPlanningCenter(personId, eventId) {
  await pcFetch("/check_ins/v2/check_ins", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "CheckIn",
        attributes: { kind: "Regular" },
        relationships: {
          person: { data: { type: "Person", id: personId } },
          event: { data: { type: "Event", id: eventId } },
        },
      },
    }),
  });
}

// Create a new person (guest) in Planning Center
// Creates the full Person record + a detailed visit note
// Labels/Workflows can be connected later once configured in Planning Center
async function createGuestInPC(guestData) {
  const visitDate = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  // 1. Create the Person record
  const person = await pcFetch("/people/v2/people", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "Person",
        attributes: {
          first_name:           guestData.firstName,
          last_name:            guestData.lastName,
          primary_email:        guestData.email,
          primary_phone_number: guestData.phone,
          street:               guestData.address || "",
          city:                 guestData.city    || "",
          state:                guestData.state   || "VA",
          zip:                  guestData.zip     || "",
          membership:           guestData.guestType === "first-time" ? "First-Time Guest" : "Returning Guest",
        },
      },
    }),
  });

  const personId = person.data.id;

  // 2. Add a detailed visit note to their profile
  await pcFetch(`/people/v2/people/${personId}/notes`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "Note",
        attributes: {
          note: [
            `Visit Date: ${visitDate}`,
            `Guest Type: ${guestData.guestType === "first-time" ? "First-Time Guest" : "Returning Guest"}`,
            `How They Heard: ${guestData.howHeard || "Not provided"}`,
            `Interests: ${guestData.interestedIn?.join(", ") || "None selected"}`,
            `Prayer Request: ${guestData.prayerRequest || "None"}`,
          ].join("\n"),
          note_category_id: null,
        },
      },
    }),
  }).catch(() => {});

  return personId;
}

// ─── DEMO MODE (no real PC credentials) ───────────────────────────────────────
const DEMO_PEOPLE = [
  { id: "1", name: "Marcus Johnson", firstName: "Marcus", lastName: "Johnson", membershipType: "Member" },
  { id: "2", name: "Denise Williams", firstName: "Denise", lastName: "Williams", membershipType: "Member" },
  { id: "3", name: "Rev. Thomas Brown", firstName: "Thomas", lastName: "Brown", membershipType: "Member" },
  { id: "4", name: "Patricia Davis", firstName: "Patricia", lastName: "Davis", membershipType: "Member" },
  { id: "5", name: "James Wilson", firstName: "James", lastName: "Wilson", membershipType: "Member" },
  { id: "6", name: "Angela Moore", firstName: "Angela", lastName: "Moore", membershipType: "Member" },
  { id: "7", name: "Deacon Robert Taylor", firstName: "Robert", lastName: "Taylor", membershipType: "Member" },
  { id: "8", name: "Sandra Anderson", firstName: "Sandra", lastName: "Anderson", membershipType: "Member" },
  { id: "9", name: "Michael Jackson", firstName: "Michael", lastName: "Jackson", membershipType: "Member" },
  { id: "10", name: "Carolyn Harris", firstName: "Carolyn", lastName: "Harris", membershipType: "Member" },
  { id: "11", name: "David Martin", firstName: "David", lastName: "Martin", membershipType: "Member" },
  { id: "12", name: "Dorothy Thompson", firstName: "Dorothy", lastName: "Thompson", membershipType: "Member" },
];
const IS_DEMO = PC_APP_ID === "YOUR_APP_ID";

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@300;400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --burgundy: #8B2332;
    --burgundy-dark: #6b1a27;
    --burgundy-light: #a8303f;
    --gold: #D4A853;
    --gold-light: #e8c57a;
    --cream: #faf7f2;
    --warm-white: #ffffff;
    --charcoal: #1c1c1e;
    --muted: #6b6b6b;
    --light-border: #e8e0d5;
    --success: #2d7a4f;
    --success-light: #e8f5ee;
  }

  body {
    font-family: 'DM Sans', sans-serif;
    background: var(--cream);
    color: var(--charcoal);
    min-height: 100vh;
  }

  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  /* HEADER */
  .header {
    background: var(--burgundy);
    color: white;
    padding: 20px 24px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 2px 20px rgba(139,35,50,0.3);
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .header-brand { display: flex; flex-direction: column; gap: 2px; }
  .header-church {
    font-family: 'Playfair Display', serif;
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--gold-light);
    line-height: 1.2;
  }
  .header-sub {
    font-size: 0.75rem;
    color: rgba(255,255,255,0.7);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .header-date {
    text-align: right;
    font-size: 0.8rem;
    color: rgba(255,255,255,0.75);
    line-height: 1.5;
  }
  .header-date strong { color: var(--gold-light); font-size: 1rem; }

  /* NAV TABS */
  .nav-tabs {
    background: var(--warm-white);
    border-bottom: 2px solid var(--light-border);
    display: flex;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .nav-tabs::-webkit-scrollbar { display: none; }
  .nav-tab {
    flex: 1;
    min-width: 100px;
    padding: 14px 8px;
    border: none;
    background: none;
    font-family: 'DM Sans', sans-serif;
    font-size: 0.8rem;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
    cursor: pointer;
    transition: all 0.2s;
    border-bottom: 3px solid transparent;
    margin-bottom: -2px;
    white-space: nowrap;
  }
  .nav-tab.active {
    color: var(--burgundy);
    border-bottom-color: var(--burgundy);
  }
  .nav-tab:hover:not(.active) { color: var(--burgundy-light); }

  /* MAIN CONTENT */
  .main { flex: 1; padding: 20px 16px; max-width: 700px; margin: 0 auto; width: 100%; }

  /* DEMO BANNER */
  .demo-banner {
    background: linear-gradient(135deg, #fff3cd, #ffeaa7);
    border: 1px solid #f0c36d;
    border-radius: 10px;
    padding: 12px 16px;
    margin-bottom: 20px;
    font-size: 0.82rem;
    color: #856404;
    line-height: 1.5;
  }
  .demo-banner strong { display: block; margin-bottom: 4px; }

  /* SEARCH */
  .search-wrapper { position: relative; margin-bottom: 20px; }
  .search-input {
    width: 100%;
    padding: 14px 16px 14px 48px;
    border: 2px solid var(--light-border);
    border-radius: 12px;
    font-family: 'DM Sans', sans-serif;
    font-size: 1rem;
    background: white;
    outline: none;
    transition: border-color 0.2s;
    color: var(--charcoal);
  }
  .search-input:focus { border-color: var(--burgundy); }
  .search-icon {
    position: absolute;
    left: 16px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--muted);
    font-size: 1.2rem;
    pointer-events: none;
  }
  .search-clear {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    background: var(--light-border);
    border: none;
    border-radius: 50%;
    width: 24px;
    height: 24px;
    cursor: pointer;
    font-size: 0.75rem;
    color: var(--muted);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* PEOPLE LIST */
  .section-label {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
    margin-bottom: 10px;
    padding-left: 4px;
  }
  .people-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
  .person-card {
    background: white;
    border: 1.5px solid var(--light-border);
    border-radius: 12px;
    padding: 14px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    transition: all 0.18s;
    gap: 12px;
  }
  .person-card:hover { border-color: var(--burgundy); box-shadow: 0 2px 12px rgba(139,35,50,0.08); }
  .person-card.checked-in {
    background: var(--success-light);
    border-color: var(--success);
    cursor: default;
  }
  .person-info { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
  .person-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--burgundy), var(--burgundy-light));
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 0.9rem;
    flex-shrink: 0;
  }
  .person-name { font-weight: 600; font-size: 0.95rem; }
  .person-type { font-size: 0.72rem; color: var(--muted); margin-top: 2px; }
  .checkin-btn {
    background: var(--burgundy);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 8px 16px;
    font-family: 'DM Sans', sans-serif;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .checkin-btn:hover { background: var(--burgundy-dark); }
  .checked-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--success);
    font-size: 0.8rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  /* GUEST FORM */
  .guest-form-card {
    background: white;
    border: 1.5px solid var(--light-border);
    border-radius: 16px;
    padding: 24px;
    margin-bottom: 20px;
  }
  .form-title {
    font-family: 'Playfair Display', serif;
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--burgundy);
    margin-bottom: 4px;
  }
  .form-subtitle { font-size: 0.85rem; color: var(--muted); margin-bottom: 20px; line-height: 1.5; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-group.full { grid-column: 1 / -1; }
  .form-label { font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .form-input, .form-select, .form-textarea {
    padding: 11px 14px;
    border: 1.5px solid var(--light-border);
    border-radius: 8px;
    font-family: 'DM Sans', sans-serif;
    font-size: 0.9rem;
    outline: none;
    transition: border-color 0.2s;
    color: var(--charcoal);
    background: white;
  }
  .form-input:focus, .form-select:focus, .form-textarea:focus { border-color: var(--burgundy); }
  .form-textarea { min-height: 80px; resize: vertical; }
  .form-submit {
    width: 100%;
    margin-top: 18px;
    padding: 14px;
    background: var(--burgundy);
    color: white;
    border: none;
    border-radius: 10px;
    font-family: 'DM Sans', sans-serif;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
    letter-spacing: 0.02em;
  }
  .form-submit:hover { background: var(--burgundy-dark); }
  .form-submit:disabled { background: var(--muted); cursor: not-allowed; }

  .success-card {
    background: var(--success-light);
    border: 1.5px solid var(--success);
    border-radius: 14px;
    padding: 28px 24px;
    text-align: center;
  }
  .success-icon { font-size: 2.5rem; margin-bottom: 12px; }
  .success-title { font-family: 'Playfair Display', serif; font-size: 1.4rem; color: var(--success); margin-bottom: 8px; }
  .success-msg { font-size: 0.9rem; color: var(--muted); line-height: 1.6; margin-bottom: 18px; }
  .success-reset {
    background: var(--success);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 10px 24px;
    font-family: 'DM Sans', sans-serif;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.9rem;
  }

  /* REPORT */
  .report-header {
    background: linear-gradient(135deg, var(--burgundy), var(--burgundy-dark));
    border-radius: 14px;
    padding: 22px;
    color: white;
    margin-bottom: 20px;
  }
  .report-title { font-family: 'Playfair Display', serif; font-size: 1.2rem; margin-bottom: 16px; color: var(--gold-light); }
  .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .stat-box { background: rgba(255,255,255,0.12); border-radius: 10px; padding: 14px 10px; text-align: center; }
  .stat-num { font-family: 'Playfair Display', serif; font-size: 2rem; font-weight: 700; color: var(--gold-light); line-height: 1; }
  .stat-label { font-size: 0.7rem; color: rgba(255,255,255,0.75); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }

  .report-section { margin-bottom: 20px; }
  .report-list { background: white; border: 1.5px solid var(--light-border); border-radius: 12px; overflow: hidden; }
  .report-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--light-border);
    font-size: 0.88rem;
  }
  .report-row:last-child { border-bottom: none; }
  .report-row-num { color: var(--muted); font-size: 0.75rem; width: 20px; flex-shrink: 0; }
  .report-row-name { flex: 1; font-weight: 500; }
  .report-row-badge {
    font-size: 0.68rem;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 20px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .badge-guest { background: #fff3cd; color: #856404; }
  .badge-member { background: #e8f0fe; color: #1a56a0; }
  .badge-time { font-size: 0.72rem; color: var(--muted); }

  .export-btn {
    width: 100%;
    padding: 13px;
    background: white;
    color: var(--burgundy);
    border: 2px solid var(--burgundy);
    border-radius: 10px;
    font-family: 'DM Sans', sans-serif;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    margin-top: 6px;
  }
  .export-btn:hover { background: var(--burgundy); color: white; }

  .empty-state {
    text-align: center;
    padding: 40px 20px;
    color: var(--muted);
    font-size: 0.9rem;
    line-height: 1.6;
  }
  .empty-state-icon { font-size: 2.5rem; margin-bottom: 12px; }

  /* GUEST TYPE SELECTOR */
  .guest-type-pills { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
  .guest-pill {
    flex: 1;
    min-width: 120px;
    padding: 10px 14px;
    border: 1.5px solid var(--light-border);
    border-radius: 10px;
    background: white;
    text-align: center;
    cursor: pointer;
    transition: all 0.18s;
    font-family: 'DM Sans', sans-serif;
  }
  .guest-pill:hover { border-color: var(--burgundy); }
  .guest-pill.selected { border-color: var(--burgundy); background: #fdf0f2; }
  .guest-pill-title { font-size: 0.85rem; font-weight: 600; color: var(--charcoal); }
  .guest-pill-sub { font-size: 0.72rem; color: var(--muted); margin-top: 3px; }

  .loading { text-align: center; padding: 30px; color: var(--muted); }
  .loading-spinner {
    width: 32px; height: 32px;
    border: 3px solid var(--light-border);
    border-top-color: var(--burgundy);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 12px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 480px) {
    .form-grid { grid-template-columns: 1fr; }
    .stats-grid { grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .stat-num { font-size: 1.6rem; }
  }
`;

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function TMCBCCheckIn() {
  const [tab, setTab] = useState("checkin");
  const [people, setPeople] = useState([]);
  const [search, setSearch] = useState("");
  const [checkedIn, setCheckedIn] = useState({}); // { id: { name, time, type } }
  const [loading, setLoading] = useState(false);
  const [eventId, setEventId] = useState(null);
  const [guestSubmitted, setGuestSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const searchRef = useRef(null);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

  // Init: load people + get/create event
  useEffect(() => {
    if (IS_DEMO) {
      setPeople(DEMO_PEOPLE);
      setEventId("demo-event");
    } else {
      initPlanningCenter();
    }
  }, []);

  // Search debounce for real PC
  useEffect(() => {
    if (IS_DEMO) {
      // Filter locally
      return;
    }
    if (search.length < 2) return;
    const timer = setTimeout(() => loadPeople(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  async function initPlanningCenter() {
    setLoading(true);
    try {
      const [evtId, people] = await Promise.all([
        getOrCreateTodayEvent(),
        fetchPeopleFromPC(),
      ]);
      setEventId(evtId);
      setPeople(people);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  async function loadPeople(term) {
    setLoading(true);
    try {
      const results = await fetchPeopleFromPC(term);
      setPeople(results);
    } catch (e) {}
    setLoading(false);
  }

  // Filter people by search (demo mode)
  const filteredPeople = IS_DEMO
    ? people.filter((p) =>
        search === "" ||
        p.name.toLowerCase().includes(search.toLowerCase())
      )
    : people;

  async function handleCheckIn(person) {
    if (checkedIn[person.id]) return;
    if (!IS_DEMO) {
      try {
        await checkInToPlanningCenter(person.id, eventId);
      } catch (e) {
        console.error("Check-in failed:", e);
      }
    }
    setCheckedIn((prev) => ({
      ...prev,
      [person.id]: {
        ...person,
        time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
        type: "member",
      },
    }));
  }

  // Report data
  const attendees = Object.values(checkedIn);
  const members = attendees.filter((a) => a.type === "member");
  const guests = attendees.filter((a) => a.type !== "member");
  const firstTime = attendees.filter((a) => a.type === "first-time");
  const secondTime = attendees.filter((a) => a.type === "second-time");

  // Export CSV
  function exportCSV() {
    const rows = [
      ["Name", "Type", "Email", "Phone", "Check-in Time"],
      ...attendees.map((a) => [a.name, a.type, a.email || "", a.phone || "", a.time]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `TMCBC-Attendance-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  }

  // Export report for printing
  function printReport() {
    window.print();
  }

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        {/* Header */}
        <div className="header">
          <div className="header-brand">
            <div className="header-church">The Mount Carmel Baptist Church</div>
            <div className="header-sub">Sunday Worship Check-In</div>
          </div>
          <div className="header-date">
            <div>{new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</div>
            <strong>{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}</strong>
          </div>
        </div>

        {/* Nav Tabs */}
        <div className="nav-tabs">
          {[
            { id: "checkin", label: "✓ Check-In" },
            { id: "guest", label: "✦ Guest Registration" },
            { id: "report", label: "⊞ Attendance Report" },
          ].map((t) => (
            <button
              key={t.id}
              className={`nav-tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="main">
          {IS_DEMO && (
            <div className="demo-banner">
              <strong>⚙️ Demo Mode — No Planning Center Connection</strong>
              To connect to Planning Center, replace <code>PC_APP_ID</code> and <code>PC_SECRET</code> at the top of this file with your credentials from{" "}
              <strong>api.planningcenteronline.com/oauth/applications</strong>. Check-ins and guests will then sync live.
            </div>
          )}

          {/* ── CHECK-IN TAB ── */}
          {tab === "checkin" && (
            <>
              <div className="search-wrapper">
                <span className="search-icon">🔍</span>
                <input
                  ref={searchRef}
                  className="search-input"
                  placeholder="Search by name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoComplete="off"
                />
                {search && (
                  <button className="search-clear" onClick={() => setSearch("")}>✕</button>
                )}
              </div>

              {loading ? (
                <div className="loading">
                  <div className="loading-spinner" />
                  Loading congregation...
                </div>
              ) : filteredPeople.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">👤</div>
                  No members found for "{search}".<br />
                  Is this their first time? Use <strong>Guest Registration</strong>.
                </div>
              ) : (
                <>
                  <div className="section-label">
                    {search ? `${filteredPeople.length} result${filteredPeople.length !== 1 ? "s" : ""}` : "Congregation"}
                  </div>
                  <div className="people-list">
                    {filteredPeople.map((person) => {
                      const isIn = !!checkedIn[person.id];
                      return (
                        <div
                          key={person.id}
                          className={`person-card ${isIn ? "checked-in" : ""}`}
                          onClick={() => !isIn && handleCheckIn(person)}
                        >
                          <div className="person-info">
                            <div className="person-avatar">
                              {person.firstName[0]}{person.lastName[0]}
                            </div>
                            <div>
                              <div className="person-name">{person.name}</div>
                              <div className="person-type">{person.membershipType}</div>
                            </div>
                          </div>
                          {isIn ? (
                            <div className="checked-badge">
                              ✅ {checkedIn[person.id].time}
                            </div>
                          ) : (
                            <button className="checkin-btn" onClick={() => handleCheckIn(person)}>
                              Check In
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── GUEST TAB ── */}
          {tab === "guest" && (
            <GuestRegistration
              eventId={eventId}
              onGuestAdded={(guest) => {
                setCheckedIn((prev) => ({
                  ...prev,
                  [`guest-${Date.now()}`]: {
                    ...guest,
                    time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
                  },
                }));
              }}
            />
          )}

          {/* ── REPORT TAB ── */}
          {tab === "report" && (
            <ReportView
              attendees={attendees}
              members={members}
              guests={guests}
              firstTime={firstTime}
              secondTime={secondTime}
              today={today}
              onExportCSV={exportCSV}
              onPrint={printReport}
            />
          )}
        </div>
      </div>
    </>
  );
}

// ─── GUEST REGISTRATION COMPONENT ────────────────────────────────────────────
function GuestRegistration({ eventId, onGuestAdded }) {
  const [guestType, setGuestType] = useState("first-time");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedName, setSubmittedName] = useState("");
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "",
    address: "", city: "", state: "VA", zip: "",
    howHeard: "", prayerRequest: "", notes: "",
    interestedIn: [],
  });

  const interests = ["Membership", "Baptism", "Bible Study", "Volunteering", "Youth Ministry", "Prayer Team"];

  function handleChange(field, val) {
    setForm((prev) => ({ ...prev, [field]: val }));
  }

  function toggleInterest(item) {
    setForm((prev) => ({
      ...prev,
      interestedIn: prev.interestedIn.includes(item)
        ? prev.interestedIn.filter((i) => i !== item)
        : [...prev.interestedIn, item],
    }));
  }

  async function handleSubmit() {
    if (!form.firstName || !form.lastName) return;
    setSubmitting(true);

    const guestData = { ...form, guestType };

    if (!IS_DEMO) {
      try {
        const personId = await createGuestInPC(guestData);
        // Check them in too
        await checkInToPlanningCenter(personId, eventId);
        guestData.id = personId;
      } catch (e) {
        console.error("Guest creation failed:", e);
      }
    }

    // Notify Pastor + greeter (logs now, sends when activated)
    await notifyTeamOfGuest(guestData);

    onGuestAdded({
      ...guestData,
      id: `guest-${Date.now()}`,
      name: `${form.firstName} ${form.lastName}`,
      type: guestType,
    });

    setSubmittedName(`${form.firstName} ${form.lastName}`);
    setSubmitted(true);
    setSubmitting(false);
  }

  function reset() {
    setSubmitted(false);
    setForm({
      firstName: "", lastName: "", email: "", phone: "",
      address: "", city: "", state: "VA", zip: "",
      howHeard: "", prayerRequest: "", notes: "", interestedIn: [],
    });
  }

  if (submitted) {
    return (
      <div className="success-card">
        <div className="success-icon">🙏</div>
        <div className="success-title">Welcome, {submittedName}!</div>
        <div className="success-msg">
          We're so glad you're here today. Your information has been recorded and
          {IS_DEMO ? " would be" : " has been"} sent to our guest care team in Planning Center.
          Someone from Mount Carmel will reach out to you this week.
        </div>
        <button className="success-reset" onClick={reset}>Register Another Guest</button>
      </div>
    );
  }

  return (
    <>
      <div className="guest-type-pills">
        {[
          { id: "first-time", label: "First-Time Guest", sub: "First visit to TMCBC" },
          { id: "second-time", label: "Returning Guest", sub: "Visited before" },
        ].map((g) => (
          <div
            key={g.id}
            className={`guest-pill ${guestType === g.id ? "selected" : ""}`}
            onClick={() => setGuestType(g.id)}
          >
            <div className="guest-pill-title">{g.label}</div>
            <div className="guest-pill-sub">{g.sub}</div>
          </div>
        ))}
      </div>

      <div className="guest-form-card">
        <div className="form-title">
          {guestType === "first-time" ? "Welcome to Mount Carmel!" : "Welcome Back!"}
        </div>
        <div className="form-subtitle">
          {guestType === "first-time"
            ? "We're honored to have you. Please share a little about yourself so our team can follow up and make you feel at home."
            : "Great to see you again! Please confirm your information below."}
        </div>

        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">First Name *</label>
            <input className="form-input" value={form.firstName} onChange={(e) => handleChange("firstName", e.target.value)} placeholder="First name" />
          </div>
          <div className="form-group">
            <label className="form-label">Last Name *</label>
            <input className="form-input" value={form.lastName} onChange={(e) => handleChange("lastName", e.target.value)} placeholder="Last name" />
          </div>
          <div className="form-group full">
            <label className="form-label">Email Address</label>
            <input className="form-input" type="email" value={form.email} onChange={(e) => handleChange("email", e.target.value)} placeholder="your@email.com" />
          </div>
          <div className="form-group full">
            <label className="form-label">Phone Number</label>
            <input className="form-input" type="tel" value={form.phone} onChange={(e) => handleChange("phone", e.target.value)} placeholder="(804) 000-0000" />
          </div>
          <div className="form-group full">
            <label className="form-label">Street Address</label>
            <input className="form-input" value={form.address} onChange={(e) => handleChange("address", e.target.value)} placeholder="123 Main Street" />
          </div>
          <div className="form-group">
            <label className="form-label">City</label>
            <input className="form-input" value={form.city} onChange={(e) => handleChange("city", e.target.value)} placeholder="Richmond" />
          </div>
          <div className="form-group">
            <label className="form-label">ZIP</label>
            <input className="form-input" value={form.zip} onChange={(e) => handleChange("zip", e.target.value)} placeholder="23223" />
          </div>
          <div className="form-group full">
            <label className="form-label">How did you hear about us?</label>
            <select className="form-select" value={form.howHeard} onChange={(e) => handleChange("howHeard", e.target.value)}>
              <option value="">Select one...</option>
              <option>Friend / Family Member</option>
              <option>Social Media (Facebook/Instagram)</option>
              <option>Website / Google Search</option>
              <option>Drove by the church</option>
              <option>Community event</option>
              <option>YouTube</option>
              <option>Other</option>
            </select>
          </div>
          <div className="form-group full">
            <label className="form-label">I'm interested in learning more about...</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "4px" }}>
              {interests.map((item) => (
                <button
                  key={item}
                  onClick={() => toggleInterest(item)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "20px",
                    border: `1.5px solid ${form.interestedIn.includes(item) ? "var(--burgundy)" : "var(--light-border)"}`,
                    background: form.interestedIn.includes(item) ? "#fdf0f2" : "white",
                    color: form.interestedIn.includes(item) ? "var(--burgundy)" : "var(--charcoal)",
                    fontSize: "0.8rem",
                    fontWeight: form.interestedIn.includes(item) ? "600" : "400",
                    cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif",
                    transition: "all 0.15s",
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group full">
            <label className="form-label">Prayer Request (optional)</label>
            <textarea
              className="form-textarea"
              value={form.prayerRequest}
              onChange={(e) => handleChange("prayerRequest", e.target.value)}
              placeholder="Share anything you'd like us to pray for..."
            />
          </div>
        </div>

        <button
          className="form-submit"
          onClick={handleSubmit}
          disabled={!form.firstName || !form.lastName || submitting}
        >
          {submitting ? "Submitting..." : "Complete Check-In →"}
        </button>
      </div>
    </>
  );
}

// ─── REPORT COMPONENT ─────────────────────────────────────────────────────────
function ReportView({ attendees, members, guests, firstTime, secondTime, today, onExportCSV, onPrint }) {
  return (
    <>
      <div className="report-header">
        <div className="report-title">📋 Attendance Report</div>
        <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.7)", marginBottom: "16px" }}>{today}</div>
        <div className="stats-grid">
          <div className="stat-box">
            <div className="stat-num">{attendees.length}</div>
            <div className="stat-label">Total Present</div>
          </div>
          <div className="stat-box">
            <div className="stat-num">{members.length}</div>
            <div className="stat-label">Members</div>
          </div>
          <div className="stat-box">
            <div className="stat-num">{guests.length}</div>
            <div className="stat-label">Guests</div>
          </div>
        </div>
        {firstTime.length > 0 && (
          <div style={{ marginTop: "12px", background: "rgba(212,168,83,0.2)", borderRadius: "8px", padding: "10px 14px", fontSize: "0.82rem", color: "var(--gold-light)" }}>
            ✦ {firstTime.length} first-time guest{firstTime.length !== 1 ? "s" : ""} today
            {secondTime.length > 0 ? ` · ${secondTime.length} returning guest${secondTime.length !== 1 ? "s" : ""}` : ""}
          </div>
        )}
      </div>

      {attendees.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          No one has checked in yet.<br />
          Check-ins will appear here as they come in.
        </div>
      ) : (
        <>
          {guests.length > 0 && (
            <div className="report-section">
              <div className="section-label">Guests ({guests.length})</div>
              <div className="report-list">
                {guests.map((a, i) => (
                  <div key={a.id || i} className="report-row">
                    <span className="report-row-num">{i + 1}</span>
                    <span className="report-row-name">{a.name}</span>
                    <span className={`report-row-badge ${a.type === "first-time" ? "badge-guest" : "badge-member"}`}>
                      {a.type === "first-time" ? "1st Visit" : "2nd Visit"}
                    </span>
                    <span className="badge-time">{a.time}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="report-section">
            <div className="section-label">Members ({members.length})</div>
            <div className="report-list">
              {members.map((a, i) => (
                <div key={a.id || i} className="report-row">
                  <span className="report-row-num">{i + 1}</span>
                  <span className="report-row-name">{a.name}</span>
                  <span className="report-row-badge badge-member">Member</span>
                  <span className="badge-time">{a.time}</span>
                </div>
              ))}
            </div>
          </div>

          <button className="export-btn" onClick={onExportCSV}>⬇ Export CSV for Planning Center</button>
          <button className="export-btn" onClick={onPrint} style={{ marginTop: "10px", background: "var(--burgundy)", color: "white", border: "none" }}>🖨 Print Report</button>
        </>
      )}
    </>
  );
}
