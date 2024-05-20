// simplified from https://github.com/ethereum/EIPs/blob/master/assets/eip-712/Example.js

import { ethers } from "hardhat";

const ethUtil = require("ethereumjs-util");

export interface Field {
  name: string;
  type: string;
}

function encodeType(name: string, fields: Field[]) {
  let result = `${name}(${fields
    .map(({ name, type }) => `${type} ${name}`)
    .join(",")})`;
  return result;
}

function typeHash(name: string, fields: Field[]) {
  return ethers.keccak256(ethers.toUtf8Bytes(encodeType(name, fields)));
}

function encodeData(name: string, fields: Field[], data: any) {
  let encTypes = [];
  let encValues = [];

  // Add typehash
  encTypes.push("bytes32");
  encValues.push(typeHash(name, fields));

  // Add field contents
  for (let field of fields) {
    let value = data[field.name];
    if (field.type === "string" || field.type === "bytes") {
      encTypes.push("bytes32");

      if (field.type === "string") {
        value = ethers.keccak256(ethers.toUtf8Bytes(value));
      } else {
        value = ethers.keccak256(value);
      }

      encValues.push(value);
    } else {
      encTypes.push(field.type);
      encValues.push(value);
    }
  }

  const encoder = new ethers.AbiCoder();
  return encoder.encode(encTypes, encValues);
}

export function structHash(name: string, fields: Field[], data: any) {
  return ethers.keccak256(encodeData(name, fields, data));
}

export const eip712Domain = {
  name: "EIP712Domain",
  fields: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
};

export function signHash(typedData: any) {
  return ethers.keccak256(
    ethers.concat([
      Buffer.from("1901", "hex"),
      structHash(eip712Domain.name, eip712Domain.fields, typedData.domain),
      structHash(typedData.name, typedData.fields, typedData.data),
    ])
  );
}
