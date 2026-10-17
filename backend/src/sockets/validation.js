import mongoose from 'mongoose';

// Socket payloads come straight from the client, so nothing about their
// shape can be assumed: a missing payload, a non-string field, or an
// object where a string belongs (which Mongo would treat as a query
// operator) must all be rejected before they reach a model.

export const MAX_QUESTION_LENGTH = 500; // mirrors Question.text maxlength
const MAX_CODE_LENGTH = 32;
const MAX_ID_LENGTH = 128;

// Thrown for bad client input. Its message is safe to send back to the
// client; any other error is reported with a generic message instead.
export class SocketInputError extends Error {}

export function asPayload(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SocketInputError('Invalid request');
  }
  return payload;
}

function requireString(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SocketInputError(`${label} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new SocketInputError(`${label} must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}

export function parseRoomCode(code) {
  return requireString(code, 'Session code', MAX_CODE_LENGTH).toUpperCase();
}

export function parseToken(token) {
  if (typeof token !== 'string' || !token) throw new SocketInputError('Invalid presenter token');
  return token;
}

export function parseViewerId(viewerId) {
  return requireString(viewerId, 'Viewer id', MAX_ID_LENGTH);
}

export function parseSlideId(slideId) {
  return requireString(slideId, 'Slide id', MAX_ID_LENGTH);
}

export function parseQuestionText(text) {
  return requireString(text, 'Question', MAX_QUESTION_LENGTH);
}

export function parseQuestionId(questionId) {
  if (typeof questionId !== 'string' || !mongoose.isValidObjectId(questionId)) {
    throw new SocketInputError('Invalid question id');
  }
  return questionId;
}

// The presenter may edit the draft before sending; omitting it sends the
// draft as is.
export function parseOptionalAnswer(answer) {
  if (answer === undefined || answer === null || answer === '') return undefined;
  if (typeof answer !== 'string') throw new SocketInputError('Answer must be text');
  return answer;
}
