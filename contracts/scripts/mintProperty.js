const hre = require('hardhat');

async function main() {
  const nftAddress = process.env.PROPERTY_NFT_ADDRESS;
  const tokenUri = process.env.PROPERTY_TOKEN_URI;
  const propertyName = process.env.PROPERTY_NAME || 'Mortgage Property';
  const location = process.env.PROPERTY_LOCATION || 'Sepolia';
  const propertyValue = process.env.PROPERTY_VALUE || '0';

  if (!nftAddress || !tokenUri) {
    throw new Error('Set PROPERTY_NFT_ADDRESS and PROPERTY_TOKEN_URI in .env before minting');
  }

  const [signer] = await hre.ethers.getSigners();
  const propertyNFT = await hre.ethers.getContractAt('PropertyNFT', nftAddress, signer);

  const tx = await propertyNFT.mintPropertyDetailed(
    signer.address,
    tokenUri,
    propertyName,
    location,
    propertyValue
  );
  const receipt = await tx.wait();
  console.log(`Minted property NFT in tx ${receipt.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
