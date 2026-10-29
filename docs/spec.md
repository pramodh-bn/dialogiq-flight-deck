# DialogIQ (Version 2) — Technical Specification & Architecture

## 1. Overview & Objectives
DialogIQ is an advanced AI-powered conversational sparring and simulation platform designed to help professionals practice and master high-stakes interpersonal communication. Version 2 evolves the core engine into a robust, multi-tier architecture featuring dynamic persona synthesis, real-time coaching "whispers," and longitudinal skill analytics.

## 2. Core Architecture Stack

```
[ Frontend: React + Vite + Tailwind ] (dialogiq-flight-deck)
│
▼ (HTTP / REST / JSON)
[ Backend: Python FastAPI Server ]
│
├──────► [ Local Database: SQLite (SQLAlchemy ORM) ]
│             └─ Stores Users, Scenarios, Sessions, & Conversation Node Trees
│
└──────► [ AI Intelligence Layer ($340 Credit Allocation) ]
├─ Baseten ──────► Muse Spark API (Dynamic Persona Synthesizer)
├─ Fireworks.ai ─► Real-Time "Whispers" Classifier (Question Quality & Empathy)
└─ Meta AI ──────► Longitudinal Analytics & Advanced Training Recommendations
```


### **A. Frontend (`dialogiq-flight-deck`)**
* **Framework:** React, Vite, Tailwind CSS, Lucide icons.
* **Views:**
  1. *Dashboard / Scenario Hub:* Bento grid overview of available practice scenarios.
  2. *Simulation Arena:* Split-screen interface featuring live character dialogue on the left and real-time coaching "Whispers" on the right.
  3. *Flight Recorder:* Visual, node-based branching tree mapping 🟢 Breakthroughs vs. 🔴 Dead-ends across turns.
  4. *Skill Analytics:* Longitudinal charts tracking open-ended question ratios and empathy metrics.

### **B. Backend & Persistence**
* **Framework:** Python FastAPI with Uvicorn and Pydantic v2 data validation.
* **Database:** SQLite (`dialogiq.db`) accessed via SQLAlchemy ORM.
* **Schema Design:**
  * `User`: Profile and session metadata.
  * `Scenario`: System prompts, persona traits, and hidden need graphs.
  * `Session`: Individual practice runs and breakthrough score tracking.
  * `ConversationNode`: Directed tree structures supporting parent-child turn relationships and branching retrospectives.

## 3. AI Provider Integration & Credit Allocation ($340 Total)
1. **Baseten ($100 Credit):** Drives the **Muse Spark API** to synthesize dynamic persona behavior and psychological resistance.
2. **Fireworks.ai ($100 Credit):** Powers low-latency inference endpoints for real-time turn classification and coaching "Whispers."
3. **Meta AI / Dev Meta AI ($140 Credit):** Handles deep longitudinal parsing, historical conversation graph evaluation, and personalized drill recommendations.

## 4. Spec-Driven Development (SDD) & Governance
* **Worktree Isolation:** Agents (`Codex`, `Claude`, `muse`, `antigravity`) operate in independent sibling worktrees (`../codex`, `../claude`, `../muse`, `..antigravity`) off `dev`.
* **Style Contracts:** Strict PEP 8 guidelines (`ruff`, max line length 88) for Python backend code; TypeScript, ESLint, and Prettier rules for the frontend.
* **Task Tracking:** Managed via Megillah boards under Project `CS` (Track `CS-T4` for Sprint 1 foundation).