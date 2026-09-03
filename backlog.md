# Product Backlog: Cleaning & Meter-Logging Robot

This document tracks new features, improvements, and ideas for the 2-Wheel Drive Cleaning & Meter-Logging Robot project.

---

> [!CAUTION]
> ### 🛑 กฎเหล็กเรื่อง Git & GitHub (Strict Git Policy)
> **ถ้า User ไม่ได้สั่ง ห้ามเอาโค้ดขึ้น GitHub เด็ดขาด!**
> Do NOT commit or push any code to GitHub unless the user explicitly commands it.

---

## 📋 Current Backlog Items

### 1. 🎵 Active Warning Buzzer during Cleaning (Soft Melody)
- **Priority:** High
- **Status:** Planning / Proposed
- **Description:** Play a soft, non-intrusive melody when the robot is actively cleaning (brush is spinning) or moving. This warns residents, preventing people looking down at their phones from stepping on the robot.
- **Hardware Requirement:**
  - 1x Passive Buzzer (Piezo Buzzer)
  - 1x Resistor (100Ω - 220Ω) to keep the sound soft.
  - Connected to GPIO 18 (or another PWM-capable pin) on the ESP32 Main Drive MCU.
- **Implementation Strategy:**
  - Code a **non-blocking state machine** using `millis()` to play the melody notes sequentially.
  - Avoid using `delay()` so motor control, PS4 controller input, and safety failsafes remain highly responsive.
  - Automatically play when `brushState == true` and turn off when `brushState == false`.

---

### 2. 📸 Meter Image Verification via Line Bot
- **Priority:** High
- **Status:** Planning / Proposed
- **Description:** Automatically send captured water and electricity meter photos to the respective room owner's Line for verification. This ensures transparency (confirming the robot isn't making up readings).
- **Core Workflow:**
  1. ESP32-CAM captures the photo and uploads it to Google Apps Script (GAS) Web App.
  2. GAS saves the photo to Google Drive, logs it in Google Sheets, and gets the image URL.
  3. GAS calls the **Line Messaging API** to send a **Flex Message** to the room owner's Line User ID.
  4. The Flex Message shows the image and provides buttons: **"✅ Confirm (ถูกต้อง)"** and **"❌ Report Issue (แจ้งข้อมูลผิด)"**.
  5. Cicking a button triggers a callback to GAS to update the Sheets log status.
  6. **Auto-Confirm:** If the room owner does not respond within 7 days, a daily GAS time-driven trigger will automatically mark it as confirmed.
- **Data Model (Google Sheets):**
  Add columns to Sheets for status tracking:
  `Timestamp | Room Number | Water Meter URL | Electricity Meter URL | Water Status | Elec Status | Last Checked Date`

---

### 2.1. ⚠️ Abnormal Water Consumption Alert
- **Priority:** Medium-High
- **Status:** Planning / Proposed
- **Description:** If the logged water consumption is abnormally high, immediately alert the dorm owner (เจ้าของหอ) via Line.
- **Logic:**
  - **This Term:** Use a Mock OCR function in Google Apps Script that generates a simulated, incrementally rising reading value based on previous entries.
  - **Next Term:** Transition to a local CV/OCR model (e.g. PaddleOCR) running on a **Raspberry Pi 5 4GB**, which is highly suitable for processing these readings locally.
  - Compare the new reading with the room's previous reading in Google Sheets.
  - Calculate monthly consumption: `Consumption = Current - Previous`.
  - If `Consumption > Threshold` (e.g. 15 units, or > 1.5x room average), send a Line notification message to the Dorm Owner with the details and image.

---

### 3. 📊 Water Usage Analytics & Prediction Web App (Loveable + Supabase)
- **Priority:** Medium
- **Status:** Planning / Proposed
- **Description:** Build a responsive, visually stunning web dashboard for room owners/tenants to view water usage logs, trends, analytics, and bills, as well as predict future bills and store historical data in **Supabase**.
- **Development Workflow:**
  1. Write a comprehensive prompt template for **Loveable.dev** (React + TypeScript + Tailwind + Recharts + Shadcn UI + Supabase integration).
  2. Use Loveable to generate the application structure, Supabase database schema (`profiles`, `meter_readings`, `prediction_logs`), and storage bucket (`meter-photos`).
  3. Connect Supabase project directly via Loveable's 1-click Supabase connection or local environment variables.
  4. Download or deploy the repository for real-time synchronization with ESP32-CAM readings and historical logs.
- **Key UI/UX & Backend Features:**
  - **Auth & Profiles:** User login/register with Role-based access (Tenant vs Dorm Owner/Admin).
  - **Aesthetics:** Sleek dark mode, glassmorphism, responsive grid layout, clean typography, soft cyan gradients.
  - **Analytics:** Interactive bar and line charts comparing current month usage with historical averages and dorm averages.
  - **Prediction System:** Enter occupancy or behavior parameters to estimate future water consumption and billing, with history saved to Supabase.
  - **Reading History Log & Verification:** Table showing historical photos from ESP32-CAM, dates, and verification status with Supabase real-time updates.
  - **Dorm Admin View:** Overview of all rooms, export summaries to CSV/Excel, and manage flagged readings.

---

## 🛠️ Proposed Tech Stack Extensions
- **Firmware:** ESP32 LEDC PWM control (for buzzer).
- **Cloud Backend:** Google Apps Script (`UrlFetchApp` for Line Messaging API, `Ocr` services for image reading).
- **Database & Auth:** Supabase (PostgreSQL, Storage Buckets, Row Level Security).
- **Messaging:** Line Developer Channel (Line Bot Messaging API & Line Notify).
- **Frontend App:** Vite + React.js, Recharts, Tailwind CSS (developed via Loveable prompt, run locally or deployed).

---

## 🔐 Project Credentials & Configuration Notes
- **Supabase Database Password:** `xyu1axWYjvwNyi7X`
- **Supabase Region:** Singapore (`ap-southeast-1`)

### Supabase Setup for Loveable (100% Match)

**1. Disable Email Confirmations:**
- Go to Supabase Dashboard > Authentication > Providers > Email
- Turn **OFF** "Confirm email" and Save. This allows testing with fake emails.

**2. Test Accounts (Register via Web App):**
- **Admin:** `admin@water.com` (Password: `Hydr0Log!_#2026`, Role: Admin)
- **Tenant:** `room302@water.com` (Password: `Hydr0Log!_#2026`, Role: Tenant, Room: 302)

**3. Database Schema & Auth Trigger SQL:**
Run this in the Supabase SQL Editor to prepare the database for Loveable:

```sql
-- 1. สร้าง Enum สำหรับสิทธิ์
create type public.app_role as enum ('tenant', 'admin');

-- 2. สร้างตาราง Profiles 
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text not null,
  phone text,
  role text default 'tenant',
  room_number text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. สร้างตาราง User Roles (ที่ Loveable แอบเพิ่มมา)
create table if not exists public.user_roles (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  role public.app_role default 'tenant'::public.app_role not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. สร้างตาราง Meter Readings
create table if not exists public.meter_readings (
  id uuid default gen_random_uuid() primary key,
  room_number text not null,
  meter_type text default 'water',
  previous_value numeric not null default 0,
  current_value numeric not null,
  consumption numeric,
  image_url text,
  status text default 'pending',
  flagged_note text,
  verified_at timestamp with time zone,
  recorded_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. สร้างตาราง Prediction Logs
create table if not exists public.prediction_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  room_number text not null,
  residents_count int not null default 1,
  washing_freq text not null,
  avg_shower_mins int not null default 10,
  has_plants boolean not null default false,
  has_dishwasher boolean not null default false,
  predicted_m3 numeric not null,
  estimated_cost_thb numeric not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. ฟังก์ชันจัดการสมัครสมาชิก (รับข้อมูลจากหน้าเว็บลง Profiles อัตโนมัติ)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, room_number, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'New User'),
    coalesce(new.raw_user_meta_data->>'room_number', 'N/A'),
    coalesce(new.raw_user_meta_data->>'role', 'tenant')
  );

  insert into public.user_roles (user_id, role)
  values (
    new.id,
    cast(coalesce(new.raw_user_meta_data->>'role', 'tenant') as public.app_role)
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 7. ฟังก์ชันของฝั่ง React
create or replace function public.current_room() returns text as $$
begin
  return (select room_number from public.profiles where id = auth.uid() limit 1);
end;
$$ language plpgsql security definer;

create or replace function public.has_role(_role public.app_role, _user_id uuid) returns boolean as $$
begin
  return exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
end;
$$ language plpgsql security definer;

-- 8. ปิด RLS ทดสอบไปก่อน (Allow All)
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.meter_readings enable row level security;
alter table public.prediction_logs enable row level security;

create policy "Allow all access profiles" on public.profiles for all using (true) with check (true);
create policy "Allow all access user_roles" on public.user_roles for all using (true) with check (true);
create policy "Allow all access meter_readings" on public.meter_readings for all using (true) with check (true);
create policy "Allow all access prediction_logs" on public.prediction_logs for all using (true) with check (true);

-- 9. Storage Bucket สำหรับภาพ
insert into storage.buckets (id, name, public) 
values ('meter-photos', 'meter-photos', true)
on conflict (id) do nothing;
create policy "Public Access Meter Photos" on storage.objects for all using (bucket_id = 'meter-photos') with check (bucket_id = 'meter-photos');
```
