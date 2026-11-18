export const MENTION_KINDS = [
    "text",
    "code",
    "svg",
    "image",
    "audio",
    "video",
    "file",
    "url",
];
export const ANCHORED_KINDS = new Set(["text", "code", "svg"]);
export const DECIDERS = ["user", "user_request", "agent"];
export class ClaimsError extends Error {
}
