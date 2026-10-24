import './runtime'
import * as loaded from 'openpgp'

type OpenPgp = typeof loaded

/**
 * OpenPGP as this runtime has it. The build for browsers is a single UMD file, and Metro hands what it exports over as the
 * default of the module and not as the module: both ways are taken, so that it works the day that changes.
 */
function exportsOf(module: OpenPgp | { default: OpenPgp }): OpenPgp {
  return 'default' in module ? module.default : module
}

export const openpgp: OpenPgp = exportsOf(loaded)

/**
 * Hermes does not look at `Symbol.species`, so `concat` of a class that extends `Array` gives a plain array and not the class.
 * OpenPGP joins the packets of a message that is signed and encrypted with the signature that follows them by `concat`, and
 * then asks the result for the packets with a tag, which only a `PacketList` can say: without this, reading such a message
 * fails with "undefined is not a function". The result is a `PacketList` again.
 */
Object.defineProperty(openpgp.PacketList.prototype, 'concat', {
  configurable: true,
  writable: true,
  value(this: unknown[], ...items: unknown[]) {
    const joined = new openpgp.PacketList()
    for (const packet of Array.prototype.concat.call([...this], ...items)) joined.push(packet)
    return joined
  }
})
