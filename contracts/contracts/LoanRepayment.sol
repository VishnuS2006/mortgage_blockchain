// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";

contract LoanRepayment is Ownable {
    struct EMI {
        uint256 amount;
        uint256 dueDate;
        bool paid;
        uint256 paidAt;
    }

    address public controller;
    mapping(uint256 => EMI[]) public loanEMIs;

    event ControllerUpdated(address indexed controller);
    event EMIScheduleGenerated(uint256 indexed loanId, uint256 count, uint256 emiAmount);
    event EMIPaid(uint256 indexed loanId, uint256 indexed emiIndex, uint256 amount);

    modifier onlyController() {
        require(msg.sender == controller, "Only controller");
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setController(address newController) external onlyOwner {
        require(newController != address(0), "Invalid controller");
        controller = newController;
        emit ControllerUpdated(newController);
    }

    function generateEMISchedule(
        uint256 loanId,
        uint256 totalPayable,
        uint256 durationMonths,
        uint256 firstDueDate
    ) external onlyController {
        require(durationMonths > 0, "Duration required");
        require(loanEMIs[loanId].length == 0, "Schedule already exists");

        uint256 emiAmount = totalPayable / durationMonths;
        uint256 runningAmount = 0;

        for (uint256 index = 0; index < durationMonths; index++) {
            uint256 installmentAmount = index == durationMonths - 1
                ? totalPayable - runningAmount
                : emiAmount;

            runningAmount += installmentAmount;
            loanEMIs[loanId].push(
                EMI({
                    amount: installmentAmount,
                    dueDate: firstDueDate + (index * 30 days),
                    paid: false,
                    paidAt: 0
                })
            );
        }

        emit EMIScheduleGenerated(loanId, durationMonths, emiAmount);
    }

    function payEMI(uint256 loanId, uint256 emiIndex)
        external
        payable
        onlyController
        returns (uint256 amount, uint256 nextDueDate)
    {
        require(emiIndex < loanEMIs[loanId].length, "Invalid EMI");

        EMI storage installment = loanEMIs[loanId][emiIndex];
        require(!installment.paid, "EMI already paid");

        installment.paid = true;
        installment.paidAt = block.timestamp;

        amount = installment.amount;
        nextDueDate = 0;

        for (uint256 index = emiIndex + 1; index < loanEMIs[loanId].length; index++) {
            if (!loanEMIs[loanId][index].paid) {
                nextDueDate = loanEMIs[loanId][index].dueDate;
                break;
            }
        }

        emit EMIPaid(loanId, emiIndex, amount);
    }

    function getPendingEMI(uint256 loanId)
        external
        view
        returns (uint256 emiIndex, uint256 amount, uint256 dueDate, bool overdue)
    {
        EMI[] storage schedule = loanEMIs[loanId];
        for (uint256 index = 0; index < schedule.length; index++) {
            EMI storage installment = schedule[index];
            if (!installment.paid) {
                return (
                    index,
                    installment.amount,
                    installment.dueDate,
                    block.timestamp > installment.dueDate + 7 days
                );
            }
        }

        return (type(uint256).max, 0, 0, false);
    }

    function getLoanEMIs(uint256 loanId) external view returns (EMI[] memory) {
        return loanEMIs[loanId];
    }

    function checkDefault(uint256 loanId) public view returns (bool) {
        EMI[] storage schedule = loanEMIs[loanId];
        for (uint256 index = 0; index < schedule.length; index++) {
            EMI storage installment = schedule[index];
            if (!installment.paid && block.timestamp > installment.dueDate + 7 days) {
                return true;
            }
        }
        return false;
    }
}
