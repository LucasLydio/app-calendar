# Role & Persona
Act as a Senior Full-Stack Engineer and Systems Architect with expertise in Model Context Protocol (MCP), REST API integration, and clean frontend development.

# Objective
Architect and implement an appointment management solution that handles manager approvals, Web Push notifications, and third-party calendar synchronization (Google Calendar & Apple Calendar). 

---

# System Constraints & Specifications

### 1. Workflow & Business Logic
* **Approval Queue**: Incoming appointments are saved in a `pending` state and routed to a Manager Approval Queue.
* **Conditional Calendar Sync**: An appointment is synchronized to Google Calendar or Apple Calendar **only after** it is approved by a manager.
* **Push Notifications**: Trigger a Web Push notification to the user immediately upon approval or rejection.
* **Availability Management**: Managers must be able to configure weekly available working days and operating hours.

### 2. Frontend & Design System Requirements
* **Stack**: Pure Vanilla HTML5, CSS3, and JavaScript (ES6+). Do not use external CSS or JS frameworks.
* **UI Aesthetic**: Modern, flat, sharp-edged interface (avoid rounded corners, `border-radius: 0` or max `2px`). Use subtle, minimal shadows for elevation.
* **CSS Tokens**: Define and strictly use the following CSS design variables:

```css
:root {
  /* Hex Palette */
  --sapphire: #4059adff;
  --blue-grey: #6b9ac4ff;
  --pearl-aqua: #97d8c4ff;
  --platinum: #eff2f1ff;
  --sunflower-gold: #f4b942ff;

  /* Color Semantics */
  --color-lighter: var(--platinum);
  --color-light: var(--pearl-aqua);
  --color-medium: var(--blue-grey);
  --color-dark: var(--sapphire);
  --color-accent: var(--sunflower-gold);

  /* Spacing Scale */
  --space-sm: 0.5rem;
  --space-md: 1.0rem;
  --space-lg: 1.5rem;
  --space-xlg: 2.5rem;

  /* Shadow Scale */
  --shadow-lighter: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-light: 0 1px 3px rgba(0, 0, 0, 0.08);
  --shadow-medium: 0 2px 4px rgba(0, 0, 0, 0.12);
  --shadow-dark: 0 4px 6px rgba(0, 0, 0, 0.16);
}
```

---

# Execution Order & Deliverables

### Part 1: Management Page Frontend (Deliver First)
Provide a complete, functional single-file implementation (HTML with embedded `<style>` and `<script>`) containing:
1. **Schedule Configuration Panel**: UI to select available working days (Mon–Sun) and set start/end time slots.
2. **Approval Queue Panel**: Table/card list displaying non-confirmed appointments with interactive "Approve" and "Reject" buttons.
3. Clean, modular JavaScript DOM functions adhering to separation of concerns and semantic HTML markup.

### Part 2: Architecture & Integration Plan
Provide an architectural breakdown explaining:
1. **API & Workflow Blueprint**: REST endpoint contracts (`POST /api/appointments`, `POST /api/appointments/{id}/approve`, `PUT /api/availability`).
2. **Calendar Integration Pipeline**: 
   - Strategy for Google Calendar API (OAuth 2.0 / Service Account event insertion).
   - Strategy for Apple Calendar (CalDAV / `.ics` feed or URL schema dispatch).
3. **Web Push Notification Engine**: Setup for VAPID keys, Service Worker registration, and payload dispatch upon status changes.
4. **MCP Architecture**: How Model Context Protocol (MCP) tool servers can be abstracted to handle calendar sync and push notification triggers dynamically.


souzamms1@fab.mil.br
70056094175
Documento de Formalização da Demanda 503/2026
https://www.youtube.com/watch?v=G8SeOH0qerk

chat act like senior developer with expertize on mcp. 
plan how does an endpoint of an appointment save the appointment on google calendar or apple calendar. 
constraints: 
the appointment only saves it on the user's calendar if the appointment is approved
the notification is sent by web push
management's page must have option to set available times and days
all non confirmed appointments goes to a page to a manager approve it
start with management's page
must be simple with html, css and js with good practices of clean code  
spaces must be with tokens like (sm, md, lg, xlg) and colors and shadows with (ligther, ligth, medium, dark)
avoid rounded forms use tiny shadows

css colors
/* CSS HEX */
--sapphire: #4059adff;
--blue-grey: #6b9ac4ff;
--pearl-aqua: #97d8c4ff;
--platinum: #eff2f1ff;
--sunflower-gold: #f4b942ff;



