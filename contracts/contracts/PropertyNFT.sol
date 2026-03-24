// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

contract PropertyNFT is ERC721URIStorage, Ownable {
    struct PropertyDetails {
        string name;
        string location;
        uint256 value;
        address originalOwner;
        bool verified;
    }

    uint256 private _nextTokenId;
    address public mortgageLoanContract;
    address public verificationRegistry;

    mapping(uint256 => address) public originalMinter;
    mapping(uint256 => PropertyDetails) private propertyDetails;

    event PropertyMinted(uint256 indexed tokenId, address indexed owner, string tokenURI);
    event PropertyVerificationUpdated(uint256 indexed tokenId, bool verified);

    constructor() ERC721("MortgageProperty", "MPROP") Ownable(msg.sender) {
        _nextTokenId = 1;
    }

    function setMortgageLoanContract(address _contract) external onlyOwner {
        require(_contract != address(0), "Invalid contract");
        require(mortgageLoanContract == address(0), "Already set");
        mortgageLoanContract = _contract;
    }

    function setVerificationRegistry(address registry) external onlyOwner {
        require(registry != address(0), "Invalid registry");
        verificationRegistry = registry;
    }

    function mintProperty(address to, string memory tokenURI_) external returns (uint256) {
        return mintPropertyDetailed(to, tokenURI_, "", "", 0);
    }

    function mintPropertyDetailed(
        address to,
        string memory tokenURI_,
        string memory propertyName,
        string memory location,
        uint256 propertyValue
    ) public returns (uint256) {
        require(to != address(0), "Invalid recipient");
        require(msg.sender == to || msg.sender == owner(), "Only property owner");
        require(bytes(tokenURI_).length > 0, "Token URI required");

        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI_);
        originalMinter[tokenId] = to;
        propertyDetails[tokenId] = PropertyDetails({
            name: propertyName,
            location: location,
            value: propertyValue,
            originalOwner: to,
            verified: false
        });

        emit PropertyMinted(tokenId, to, tokenURI_);
        return tokenId;
    }

    function setPropertyVerificationStatus(uint256 tokenId, bool verified) external {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        require(
            msg.sender == owner() || msg.sender == mortgageLoanContract || msg.sender == verificationRegistry,
            "Not authorized"
        );

        propertyDetails[tokenId].verified = verified;
        emit PropertyVerificationUpdated(tokenId, verified);
    }

    function getPropertyDetails(uint256 tokenId) external view returns (PropertyDetails memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        return propertyDetails[tokenId];
    }

    function getNextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }
}
