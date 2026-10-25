// src/lib/events.js — Client-side Event Management & Check-in API Client
import { api } from "./api.js";

export async function listEvents() {
  return await api("/api/events?action=list", { method: "GET" });
}

export async function getEvent(id) {
  return await api(`/api/events?action=get&id=${encodeURIComponent(id)}`, { method: "GET" });
}

export async function createEvent(event) {
  return await api("/api/events?action=create", {
    method: "POST",
    body: { event },
  });
}

export async function updateEvent(id, patch) {
  return await api(`/api/events?action=update&id=${encodeURIComponent(id)}`, {
    method: "POST",
    body: { id, patch },
  });
}

export async function deleteEvent(id) {
  return await api(`/api/events?action=delete&id=${encodeURIComponent(id)}`, {
    method: "POST",
    body: { id },
  });
}

export async function createTicket(eventId, guestData) {
  return await api("/api/events?action=create-ticket", {
    method: "POST",
    body: { eventId, ...guestData },
  });
}

export async function importGuests(eventId, guests) {
  return await api("/api/events?action=import-guests", {
    method: "POST",
    body: { eventId, guests },
  });
}

export async function revokeTicket(ticketId) {
  return await api("/api/events?action=revoke-ticket", {
    method: "POST",
    body: { ticketId },
  });
}

export async function regenerateTicket(ticketId) {
  return await api("/api/events?action=regenerate-ticket", {
    method: "POST",
    body: { ticketId },
  });
}

export async function checkTicket(token) {
  return await api(`/api/events?action=check-ticket&token=${encodeURIComponent(token)}`, {
    method: "GET",
    signedIn: false,
  });
}

export async function checkInTicket({ token, eventId, operator }) {
  return await api("/api/events?action=check-in", {
    method: "POST",
    body: { token, eventId, operator },
    signedIn: false,
  });
}
