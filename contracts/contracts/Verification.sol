 // SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IPropertyNFTVerification {
    function setPropertyVerificationStatus(uint256 tokenId, bool verified) external;
}

contract Verification is Ownable {
    mapping(address => bool) public authorizedVerifiers;
    mapping(bytes32 => bool) private verifiedProperties;

    event VerifierAuthorizationUpdated(address indexed verifier, bool authorized);
    event PropertyVerified(address indexed nftContract, uint256 indexed tokenId, address indexed verifier);
    event PropertyVerificationRevoked(address indexed nftContract, uint256 indexed tokenId);

    modifier onlyVerifier() {
        require(msg.sender == owner() || authorizedVerifiers[msg.sender], "Only verifier");
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setVerifierAuthorization(address verifier, bool authorized) external onlyOwner {
        require(verifier != address(0), "Invalid verifier");
        authorizedVerifiers[verifier] = authorized;
        emit VerifierAuthorizationUpdated(verifier, authorized);
    }

    function verifyProperty(address nftContract, uint256 tokenId) external onlyVerifier {
        bytes32 key = propertyKey(nftContract, tokenId);
        verifiedProperties[key] = true;
        try IPropertyNFTVerification(nftContract).setPropertyVerificationStatus(tokenId, true) {} catch {}
        emit PropertyVerified(nftContract, tokenId, msg.sender);
    }

    function revokePropertyVerification(address nftContract, uint256 tokenId) external onlyOwner {
        bytes32 key = propertyKey(nftContract, tokenId);
        verifiedProperties[key] = false;
        try IPropertyNFTVerification(nftContract).setPropertyVerificationStatus(tokenId, false) {} catch {}
        emit PropertyVerificationRevoked(nftContract, tokenId);
    }

    function isPropertyVerified(address nftContract, uint256 tokenId) external view returns (bool) {
        return verifiedProperties[propertyKey(nftContract, tokenId)];
    }

    function propertyKey(address nftContract, uint256 tokenId) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(nftContract, tokenId));
    }
}
