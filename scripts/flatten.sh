#!/bin/sh

set -ex

rm -rf temp
mkdir -p temp

alias flatten="npx hardhat flatten"

flatten contracts/WyvernAtomicizer.sol > temp/WyvernAtomicizer.sol
flatten contracts/WyvernRegistry.sol > temp/WyvernRegistry.sol
flatten contracts/WyvernExchange.sol > temp/WyvernExchange.sol
flatten contracts/WyvernStatic.sol > temp/WyvernStatic.sol
