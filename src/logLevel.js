/**
 * The `arnft` system's `logLevel` attribute, mapped to jsartoolkitNFT's
 * `ARLogLevel`.
 *
 * The numbers mirror the `ARLogLevel` enum exported by
 * `@webarkit/jsartoolkit-nft`, where lower is more verbose. They are
 * duplicated here rather than imported so this module stays free of the
 * tracker bundle and can be unit-tested in isolation.
 *
 * @module logLevel
 */

const AR_LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

/** Used when the attribute is not set, and for unknown names. */
export const DEFAULT_LOG_LEVEL = 'warn';

/** The accepted `logLevel` names, most verbose first. */
export const LOG_LEVEL_NAMES = Object.keys(AR_LOG_LEVELS);

/**
 * Convert a `logLevel` name to jsartoolkitNFT's numeric `ARLogLevel`.
 *
 * A-Frame does not enforce a schema's `oneOf`, so a mistyped value reaches this
 * function. It then falls back to {@link DEFAULT_LOG_LEVEL} and warns once.
 *
 * @param {string} name `debug`, `info`, `warn` or `error`; case is ignored.
 * @returns {number} The `ARLogLevel` value.
 */
export function toARLogLevel(name) {
    const key = String(name).toLowerCase();
    if (Object.hasOwn(AR_LOG_LEVELS, key)) {
        return AR_LOG_LEVELS[key];
    }
    console.warn(
        `arnft: unknown logLevel "${name}"; using "${DEFAULT_LOG_LEVEL}". ` +
            `Use one of: ${LOG_LEVEL_NAMES.join(', ')}.`,
    );
    return AR_LOG_LEVELS[DEFAULT_LOG_LEVEL];
}
