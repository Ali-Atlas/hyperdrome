import clsx from 'clsx';

/**
 * Merge classnames. Thin wrapper around clsx so component code can
 * compose CSS Module class names with conditional/extra classes in one call.
 * @param  {...any} inputs - class values (string, object, array, falsy)
 * @returns {string}
 */
export function cn(...inputs) {
  return clsx(inputs);
}
