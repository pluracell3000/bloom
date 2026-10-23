// Explicit owner handoff. Only RSA-OAEP ciphertext leaves the secret-bearing
// environment. Keep the matching private key outside Git in the owner's workspace.
import { createPublicKey, publicEncrypt, constants } from 'node:crypto';
const recipient = process.argv.find(arg => arg.startsWith('--recipient='))?.slice(12);
if (!recipient || !process.env.BLOOM_READER_KEY) throw new Error('A recipient public key and configured reader key are required');
const publicKey = createPublicKey({ key: Buffer.from(recipient, 'base64'), type: 'spki', format: 'der' });
if (publicKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyDetails.modulusLength < 3072) throw new Error('Use RSA 3072 bits or stronger');
const encrypted = publicEncrypt({key:publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(process.env.BLOOM_READER_KEY));
console.log(`BLOOM_READER_HANDOFF:${encrypted.toString('base64')}`);
