import path from "node:path";

export const REVIEW_VERSION = 1;
export const REVIEW_STATES = ["pending", "approved", "rejected"];

export function createReview(capture, card, { now = new Date() } = {}) {
  return {
    schema_version: REVIEW_VERSION,
    id: `review-${capture.id}`,
    state: "pending",
    created_at: now.toISOString(),
    decided_at: null,
    decision_note: "",
    capture_id: capture.id,
    capture_file: `${capture.id}.json`,
    card_id: card.id,
    card_file: card.filename,
  };
}

export function validateReview(review) {
  if (!review || typeof review !== "object" || Array.isArray(review)) throw new Error("review must be an object");
  if (review.schema_version !== REVIEW_VERSION) throw new Error(`review schema_version must be ${REVIEW_VERSION}`);
  if (!/^review-cap-[a-zA-Z0-9-]{8,80}$/.test(review.id || "")) throw new Error("review id is invalid");
  if (!REVIEW_STATES.includes(review.state)) throw new Error(`review state must be one of: ${REVIEW_STATES.join(", ")}`);
  for (const field of ["created_at", "capture_id", "capture_file", "card_id", "card_file"]) {
    if (typeof review[field] !== "string" || !review[field]) throw new Error(`review ${field} is required`);
  }
  if (path.basename(review.capture_file) !== review.capture_file || !review.capture_file.endsWith(".json")) throw new Error("review capture_file must be a JSON basename");
  if (path.basename(review.card_file) !== review.card_file || !review.card_file.endsWith(".md")) throw new Error("review card_file must be a Markdown basename");
  return review;
}
