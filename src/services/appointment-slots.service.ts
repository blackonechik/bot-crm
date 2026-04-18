import { prisma } from '../db/prisma';

type ClinicProfileLike = {
  workingHours?: unknown;
  doctors?: unknown;
  services?: unknown;
};

type Slot = {
  scheduledAt: string;
  label: string;
  doctor: string | null;
  specialization: string | null;
};

function normalizeText(text: string): string {
  return text.trim().toLowerCase();
}

function getWeekdaySchedule(hours: unknown, date: Date): string | null {
  if (!hours || typeof hours !== 'object') return null;
  const schedule = hours as Record<string, unknown>;
  const weekdayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const value = schedule[weekdayKeys[date.getDay()]];
  return typeof value === 'string' ? value : null;
}

function parseSchedule(schedule: string | null): { start: string; end: string } | null {
  if (!schedule || schedule === 'closed') return null;
  const match = schedule.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!match) return null;
  return { start: match[1], end: match[2] };
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function combineDateAndTime(baseDate: Date, time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const result = new Date(baseDate);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

function formatLabel(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function getDoctorCandidates(profile: ClinicProfileLike, specialization?: string, doctorName?: string) {
  const doctors = Array.isArray(profile.doctors) ? (profile.doctors as Array<Record<string, unknown>>) : [];

  if (doctorName) {
    const target = normalizeText(doctorName);
    return doctors.filter((doctor) => normalizeText(String(doctor.name ?? '')).includes(target));
  }

  if (specialization) {
    const target = normalizeText(specialization);
    const filtered = doctors.filter((doctor) => normalizeText(String(doctor.specialization ?? '')).includes(target));
    return filtered.length ? filtered : doctors;
  }

  return doctors;
}

function getDurationMinutes(profile: ClinicProfileLike, specialization?: string, doctorName?: string): number {
  const doctors = getDoctorCandidates(profile, specialization, doctorName);
  const doctor = doctors[0];
  const doctorDuration = doctor?.durationMinutes;
  if (typeof doctorDuration === 'number' && Number.isFinite(doctorDuration) && doctorDuration >= 10) {
    return doctorDuration;
  }

  const services = Array.isArray(profile.services) ? (profile.services as Array<Record<string, unknown>>) : [];
  if (specialization) {
    const target = normalizeText(specialization);
    const service = services.find((item) => normalizeText(String(item.name ?? '')).includes(target));
    const serviceDuration = service?.durationMinutes;
    if (typeof serviceDuration === 'number' && Number.isFinite(serviceDuration) && serviceDuration >= 10) {
      return serviceDuration;
    }
  }

  return 30;
}

export async function getAvailableAppointmentSlots(params: {
  profile: ClinicProfileLike;
  from?: string;
  days?: number;
  limit?: number;
  specialization?: string;
  doctorName?: string;
}): Promise<Slot[]> {
  const startDate = params.from ? new Date(params.from) : new Date();
  if (Number.isNaN(startDate.getTime())) {
    throw new Error('Invalid from date');
  }

  const days = Math.max(1, Math.min(params.days ?? 14, 30));
  const limit = Math.max(1, Math.min(params.limit ?? 10, 50));
  const durationMinutes = getDurationMinutes(params.profile, params.specialization, params.doctorName);
  const doctors = getDoctorCandidates(params.profile, params.specialization, params.doctorName);
  const doctor = doctors[0] ?? null;

  const windowEnd = addMinutes(startDate, days * 24 * 60);
  const occupiedWhere: Record<string, unknown> = {
    scheduledAt: { gte: startDate, lte: windowEnd }
  };
  const occupiedOr: Array<Record<string, unknown>> = [];

  if (doctor?.name) {
    occupiedOr.push({ doctor: String(doctor.name) });
  }

  if (params.specialization) {
    occupiedOr.push({ service: { contains: params.specialization, mode: 'insensitive' } });
  }

  if (occupiedOr.length > 0) {
    occupiedWhere.OR = occupiedOr;
  }

  const occupied = await prisma.appointment.findMany({
    where: occupiedWhere,
    select: { scheduledAt: true, doctor: true, service: true }
  });

  const occupiedStarts = new Set(occupied.map((item) => item.scheduledAt.getTime()));
  const slots: Slot[] = [];

  for (let dayOffset = 0; dayOffset < days && slots.length < limit; dayOffset += 1) {
    const day = addMinutes(startDate, dayOffset * 24 * 60);
    const schedule = parseSchedule(getWeekdaySchedule(params.profile.workingHours, day));
    if (!schedule) continue;

    const dayStart = combineDateAndTime(day, schedule.start);
    const dayEnd = combineDateAndTime(day, schedule.end);

    for (let cursor = new Date(dayStart); cursor.getTime() + durationMinutes * 60_000 <= dayEnd.getTime() && slots.length < limit; cursor = addMinutes(cursor, durationMinutes)) {
      if (cursor.getTime() < startDate.getTime()) continue;
      if (occupiedStarts.has(cursor.getTime())) continue;

      slots.push({
        scheduledAt: cursor.toISOString(),
        label: formatLabel(cursor),
        doctor: doctor ? String(doctor.name ?? null) : null,
        specialization: params.specialization ?? (doctor ? String(doctor.specialization ?? null) : null)
      });
    }
  }

  return slots;
}

export async function isAppointmentSlotAvailable(params: {
  profile: ClinicProfileLike;
  scheduledAt: Date;
  specialization?: string;
  doctorName?: string;
}): Promise<boolean> {
  const slots = await getAvailableAppointmentSlots({
    profile: params.profile,
    from: params.scheduledAt.toISOString(),
    days: 1,
    limit: 24,
    specialization: params.specialization,
    doctorName: params.doctorName
  });

  return slots.some((slot) => new Date(slot.scheduledAt).getTime() === params.scheduledAt.getTime());
}
