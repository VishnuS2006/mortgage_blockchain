// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IMortgageCoreAutomation {
    function canMarkDefault(uint256 loanId) external view returns (bool);
    function markDefaultFromAutomation(uint256 loanId) external;
}

contract LoanAutomation is Ownable {
    IMortgageCoreAutomation public mortgageCore;

    event MortgageCoreUpdated(address indexed mortgageCore);
    event LoanMarkedDefault(uint256 indexed loanId);

    constructor(address mortgageCoreAddress) Ownable(msg.sender) {
        setMortgageCore(mortgageCoreAddress);
    }

    function setMortgageCore(address mortgageCoreAddress) public onlyOwner {
        require(mortgageCoreAddress != address(0), "Invalid core");
        mortgageCore = IMortgageCoreAutomation(mortgageCoreAddress);
        emit MortgageCoreUpdated(mortgageCoreAddress);
    }

    function checkLoanHealth(uint256 loanId) external view returns (bool unhealthy) {
        return mortgageCore.canMarkDefault(loanId);
    }

    function autoMarkDefault(uint256 loanId) external {
        require(mortgageCore.canMarkDefault(loanId), "Loan healthy");
        mortgageCore.markDefaultFromAutomation(loanId);
        emit LoanMarkedDefault(loanId);
    }
}
