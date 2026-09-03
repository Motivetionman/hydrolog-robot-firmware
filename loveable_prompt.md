# Loveable.dev Web App Prompt: HydroLog with Supabase Integration

คัดลอกข้อความในบล็อก Markdown ด้านล่างนี้ทั้งหมด แล้วนำไปวางใน **Loveable.dev** เพื่อสร้างระบบ Full-Stack Frontend + Supabase Backend ได้ทันทีครับ

---

```text
Create a modern, full-stack ready Web Application for Dormitory Water Usage Analytics, Verification & Prediction Dashboard called "HydroLog".

The app integrates with Supabase for user authentication, role-based access (Tenant vs. Dorm Admin/Owner), historical meter logging from ESP32-CAM robots, and water bill prediction history.

---

### 🗄️ 1. Supabase Backend Architecture & Schema

Please design and generate the Supabase database schema, TypeScript types, RLS (Row Level Security) policies, and client integration with `@supabase/supabase-js`:

#### Database Tables:
1. `profiles`:
   - `id` (UUID, primary key, references `auth.users.id`)
   - `full_name` (text)
   - `phone` (text, optional)
   - `role` (text: 'tenant' | 'admin', default: 'tenant')
   - `room_number` (text, e.g. "302")
   - `created_at` (timestamptz)

2. `meter_readings`:
   - `id` (UUID, primary key, default `gen_random_uuid()`)
   - `room_number` (text, indexed)
   - `meter_type` (text: 'water' | 'electricity', default: 'water')
   - `previous_value` (numeric)
   - `current_value` (numeric)
   - `consumption` (numeric, generated or calculated)
   - `image_url` (text, URL of meter photo stored in Supabase Storage or Google Drive)
   - `status` (text: 'pending' | 'confirmed' | 'flagged', default: 'pending')
   - `flagged_note` (text, optional)
   - `verified_at` (timestamptz, optional)
   - `recorded_at` (timestamptz, default `now()`)

3. `prediction_logs`:
   - `id` (UUID, primary key)
   - `user_id` (UUID, references `profiles.id`)
   - `room_number` (text)
   - `residents_count` (int)
   - `washing_freq` (text)
   - `avg_shower_mins` (int)
   - `has_plants` (boolean)
   - `has_dishwasher` (boolean)
   - `predicted_m3` (numeric)
   - `estimated_cost_thb` (numeric)
   - `created_at` (timestamptz, default `now()`)

#### Storage Bucket:
- Bucket name: `meter-photos` (Public bucket for storing photos captured by ESP32-CAM).

#### Data Layer & Hooks:
- Create modular React Query / custom hooks with Supabase client:
  - `useAuth()` (Sign in, Sign up, Sign out, Profile)
  - `useMeterReadings(roomNumber, filterDateRange)` (Real-time subscription or polling)
  - `useVerifyReading()` (Update reading status: 'confirmed' or 'flagged' with note)
  - `usePredictionHistory()`
- **Graceful Fallback**: If Supabase environment variables are missing or user is not logged in, provide rich mock data seamlessly so the UI is 100% functional and interactive.

---

### 🎨 2. Design System & Aesthetics (Modern Glassmorphism)
- **Theme**: Premium Dark Mode (#09090b, #121217) with glowing Cyan/Teal (#00e5ff, #06b6d4, #0284c7) and Emerald accents.
- **Glassmorphism**: Backdrop-blur cards (`backdrop-blur-md bg-zinc-900/60 border border-zinc-800/80 shadow-xl`).
- **Typography**: Clean modern sans-serif (Inter / Outfit / Plus Jakarta Sans).
- **Interactive UI**: Micro-interactions, animated number counters, smooth tab transitions, and Recharts with custom tooltips.

---

### 🛠️ 3. Key Pages & Features to Build:

#### 🔐 Auth & Role Switcher:
- Login / Register modal with Email & Password.
- Quick Role Demo Switcher in top navigation: **"Tenant View (Room 302)"** vs **"Dorm Admin / Owner View (All Rooms Overview)"**.

#### 📊 Page 1: Dashboard (Overview)
- **Hero Next-Bill Predictor Gauge**: Circular progress / gauge showing estimated next bill (e.g. 345 THB / 18.5 m³) with status badge ("Normal" / "Abnormally High - Leak Risk").
- **Metric Cards**:
  - Current Monthly Usage (m³) with % change from last month.
  - Estimated Bill (THB).
  - Last Reading Date & Verification status.
  - Active Leak Warning banner if abnormal spike is detected.
- **Recent Meter Verification Card**: Shows thumbnail of latest photo taken by robot with quick "Verify" action.

#### 📈 Page 2: Usage Analytics (Interactive Charts)
- **Monthly Usage Bar Chart**: Historical 6-12 months comparison (This Year vs Last Year).
- **Weekly Trend Area Chart**: Daily breakdown showing weekday vs weekend usage patterns.
- **Dorm Benchmark Chart**: Horizontal bar comparing this room vs 1-person avg, 2-person avg, and entire dorm building avg.

#### 🧮 Page 3: Interactive Water Bill Predictor
- Step-by-step interactive calculator with Sliders & Toggles:
  - Number of residents (1 - 5 people)
  - Washing machine frequency (Daily, 2-3x/week, Once/week, None)
  - Average shower duration (minutes)
  - Special usage toggles (Plants, Dishwasher)
- **Live Output Card**:
  - Dynamic estimated daily liters and monthly m³.
  - Estimated cost breakdown based on dormitory rate (e.g., 18 THB/unit).
  - "Save Prediction to History" button (saves to Supabase `prediction_logs`).
  - Personalized water-saving tips based on highest consumption factors.

#### 📜 Page 4: Historical Logs & Robot Photo Verification
- **Historical Table & Filters**:
  - Filter by date range, meter type (Water / Electricity), and status (Confirmed / Pending / Flagged).
  - Columns: Timestamp, Meter Type, Previous & Current Readings, Consumption (Units), Status Badge, Action Button.
- **Photo Verification Modal** (on clicking "View Photo"):
  - High-resolution modal display of photo taken by ESP32-CAM.
  - Meter Details (Date, Time, OCR Reading Value).
  - User verification actions:
    - `✅ Confirm (ข้อมูลถูกต้อง)` -> Updates status in Supabase.
    - `❌ Report Issue (แจ้งข้อมูลผิดพลาด)` -> Opens text box for note (e.g. "ตัวเลขมิเตอร์เบลอ", "อ่านเลขผิด") and sets status to `flagged`.

#### 🏢 Page 5: Admin / Dorm Owner View (Accessible when Admin mode selected)
- Overview table of all dormitory rooms (Rooms 101 - 510).
- Filter rooms with pending verification or flagged meter readings.
- Export monthly meter summary to CSV / Excel.
- Button to trigger mock ESP32-CAM upload to test live real-time sync.

---

### 📦 Tech Stack & Dependencies:
- React 18, Vite, TypeScript, Tailwind CSS
- Lucide React icons
- Shadcn UI components (Card, Button, Dialog, Select, Slider, Badge, Input, Tabs, Toast, Table, DropdownMenu)
- Recharts for data visualization
- `@supabase/supabase-js` and `@tanstack/react-query`
- Canvas-confetti for celebrating bill savings
```
